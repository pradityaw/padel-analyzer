#!/usr/bin/env node
/**
 * Drain Telegram (collect), group threads, run cloud Cursor agents, post summary to Telegram.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { collectMessages } from "./collect.mjs";
import { loadFeedbackEnv, repoRoot } from "./env.mjs";

const PROMPT_PATH = resolve(
  repoRoot,
  "scripts/cursor-sdk/prompts/feedback-implement.md"
);
const FEEDBACK_DIR = resolve(repoRoot, "qa-artifacts/feedback");
const STATE_PATH = resolve(FEEDBACK_DIR, "state.json");
const INBOX_PATH = resolve(FEEDBACK_DIR, "inbox.jsonl");
const RUN_LOG_DIR = resolve(repoRoot, ".cursor-sdk-runs/feedback");

const DEFAULT_REPO_URL = "https://github.com/pradityaw/padel-analyzer.git";

function parseArgs(argv) {
  const args = { dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--help" || a === "-h") {
      console.log(`Usage: node scripts/feedback-bot/triage.mjs [--dry-run]

Environment:
  CURSOR_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_FEEDBACK_CHAT_ID,
  TELEGRAM_ALLOWLIST_USER_IDS (optional), FEEDBACK_REPO_URL (optional),
  FEEDBACK_MAX_MESSAGES_PER_RUN (default 100), FEEDBACK_MAX_PRS_PER_RUN (default 3),
  FEEDBACK_MODEL (default composer-2)
`);
      process.exit(0);
    }
  }
  return args;
}

function readState() {
  if (!existsSync(STATE_PATH)) {
    return {
      last_update_id: 0,
      consumed_update_id: 0,
      processed_update_ids: [],
    };
  }
  try {
    const j = JSON.parse(readFileSync(STATE_PATH, "utf8"));
    return {
      last_update_id: Number(j.last_update_id) || 0,
      consumed_update_id: Number(j.consumed_update_id) || 0,
      processed_update_ids: Array.isArray(j.processed_update_ids)
        ? j.processed_update_ids.map(Number).filter(Number.isFinite)
        : [],
    };
  } catch {
    return {
      last_update_id: 0,
      consumed_update_id: 0,
      processed_update_ids: [],
    };
  }
}

function writeState(next) {
  mkdirSync(FEEDBACK_DIR, { recursive: true });
  writeFileSync(STATE_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

function loadInboxRecords() {
  if (!existsSync(INBOX_PATH)) return [];
  const text = readFileSync(INBOX_PATH, "utf8");
  return text
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

/**
 * @param {unknown[]} records
 * @returns {Map<string, { key: string, messages: typeof records }>}
 */
function buildThreads(records) {
  /** @type {Map<number, typeof records[0]>} */
  const byMessageId = new Map();
  for (const r of records) {
    byMessageId.set(r.message_id, r);
  }

  function replyRoot(r) {
    let cur = r;
    const seen = new Set();
    while (cur?.reply_to_message_id && !seen.has(cur.message_id)) {
      seen.add(cur.message_id);
      const parent = byMessageId.get(cur.reply_to_message_id);
      if (!parent) break;
      cur = parent;
    }
    return cur.message_id;
  }

  /** @type {Map<string, { key: string, messages: typeof records }>} */
  const threads = new Map();

  /** @type {typeof records} */
  const noReply = [];

  for (const r of records) {
    if (r.reply_to_message_id) {
      const root = replyRoot(r);
      const key = `reply-${root}`;
      if (!threads.has(key))
        threads.set(key, { key, messages: /** @type {typeof records} */ ([]) });
      threads.get(key).messages.push(r);
    } else {
      noReply.push(r);
    }
  }

  noReply.sort(
    (a, b) =>
      (a.date ?? 0) - (b.date ?? 0) || (a.update_id ?? 0) - (b.update_id ?? 0)
  );

  let idx = 0;
  while (idx < noReply.length) {
    const cluster = [noReply[idx]];
    let lastInCluster = noReply[idx];
    idx += 1;
    while (idx < noReply.length) {
      const next = noReply[idx];
      if (next.from.id !== lastInCluster.from.id) break;
      if ((next.date ?? 0) - (lastInCluster.date ?? 0) > 300) break;
      cluster.push(next);
      lastInCluster = next;
      idx += 1;
    }
    const key = `burst-${cluster[0].message_id}`;
    threads.set(key, { key, messages: cluster });
  }

  for (const t of threads.values()) {
    t.messages.sort(
      (a, b) =>
        (a.date ?? 0) - (b.date ?? 0) ||
        (a.update_id ?? 0) - (b.update_id ?? 0)
    );
  }

  return threads;
}

function summarizeStreamEvent(event) {
  if (event.type === "assistant") {
    const text = event.message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
    return text.trim() ? `\n${text.trim()}\n` : undefined;
  }
  if (event.type === "status") {
    return `[status] ${event.status}${event.message ? `: ${event.message}` : ""}`;
  }
  if (event.type === "tool_call") {
    return `[tool] ${event.name} ${event.status}`;
  }
  return undefined;
}

function parseFeedbackFooter(fullText) {
  const blockIdx = fullText.lastIndexOf("FEEDBACK_RESULT");
  if (blockIdx === -1) return null;
  const slice = fullText.slice(blockIdx);
  const lines = slice.split(/\n/).filter(Boolean);
  /** @type {Record<string, string>} */
  const out = {};
  for (const line of lines.slice(1)) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (m) out[m[1]] = m[2]?.trim() ?? "";
  }
  return out;
}

function extractPrUrl(text) {
  const footer = parseFeedbackFooter(text);
  if (footer?.pr_url?.startsWith("http")) return footer.pr_url;
  const m = text.match(/https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/);
  return m ? m[0] : null;
}

async function tgPostJson(token, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) {
    throw new Error(
      `Telegram ${method} failed: ${json.description || JSON.stringify(json)}`
    );
  }
  return json.result;
}

async function sendTelegramSummary(token, chatId, lines) {
  const text = lines.join("\n").slice(0, 3900);
  await tgPostJson(token, "sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: false,
  });
}

async function loadSdk() {
  const sdk = await import("@cursor/sdk");
  return { Agent: sdk.Agent, CursorSdkError: sdk.CursorSdkError };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadFeedbackEnv();

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_FEEDBACK_CHAT_ID;

  if (args.dryRun && !process.env.TELEGRAM_BOT_TOKEN) {
    console.warn(
      "[triage] dry-run: skipping Telegram collect (set TELEGRAM_BOT_TOKEN to drain new messages)"
    );
  } else {
    console.log("[triage] Running collect...");
    const collectResult = await collectMessages({ silent: true });
    console.log(
      `[triage] collect appended=${collectResult.appended} last_update_id=${collectResult.last_update_id}`
    );
  }

  let state = readState();
  const processedSet = new Set(state.processed_update_ids);

  const maxMsgs = Number(process.env.FEEDBACK_MAX_MESSAGES_PER_RUN) || 100;
  const maxPrs = Number(process.env.FEEDBACK_MAX_PRS_PER_RUN) || 3;
  const repoUrl = process.env.FEEDBACK_REPO_URL || DEFAULT_REPO_URL;
  const modelId = process.env.FEEDBACK_MODEL || "composer-2";

  const allRecords = loadInboxRecords();
  const records = allRecords.filter((r) => !processedSet.has(r.update_id));

  if (records.length === 0) {
    console.log("[triage] No unprocessed inbox messages.");
    return;
  }

  const threads = buildThreads(records);
  let threadList = [...threads.values()].map((t) => ({
    ...t,
    minUpdate: Math.min(...t.messages.map((m) => m.update_id)),
    maxUpdate: Math.max(...t.messages.map((m) => m.update_id)),
  }));
  threadList.sort((a, b) => a.minUpdate - b.minUpdate);

  /** @type {typeof threadList} */
  const selected = [];
  let totalMsgs = 0;
  for (const t of threadList) {
    if (selected.length >= maxPrs) break;
    if (totalMsgs + t.messages.length > maxMsgs) break;
    selected.push(t);
    totalMsgs += t.messages.length;
  }

  const deferredCount = threadList.length - selected.length;

  const promptTemplate = existsSync(PROMPT_PATH)
    ? readFileSync(PROMPT_PATH, "utf8").trim()
    : "";

  console.log(
    `[triage] threads=${threadList.length} selected=${selected.length} deferred=${deferredCount} unprocessed_msgs=${records.length}`
  );

  if (args.dryRun) {
    for (const t of selected) {
      const bundle = {
        thread_id: t.key,
        summary_hint: null,
        repo_url: repoUrl,
        messages: t.messages.map((m) => ({
          update_id: m.update_id,
          message_id: m.message_id,
          text: m.text,
          ts: m.ts,
          reply_to_message_id: m.reply_to_message_id,
          from: m.from,
          media: m.media,
        })),
      };
      console.log("\n--- bundle ---\n", JSON.stringify(bundle, null, 2));
    }
    return;
  }

  if (!token || !chatId) {
    throw new Error(
      "Set TELEGRAM_BOT_TOKEN and TELEGRAM_FEEDBACK_CHAT_ID for Telegram summary."
    );
  }

  if (selected.length === 0) {
    await sendTelegramSummary(token, chatId, [
      `Daily triage: ${records.length} unprocessed msg(s) → 0 agent runs`,
      `No threads fit current caps (max ${maxMsgs} msgs, ${maxPrs} PRs/run). Deferred ${threadList.length} thread(s).`,
      `Increase FEEDBACK_MAX_MESSAGES_PER_RUN / FEEDBACK_MAX_PRS_PER_RUN or wait for the next run.`,
    ]);
    console.warn(
      `[triage] Nothing selected under caps (threads=${threadList.length}).`
    );
    return;
  }

  if (!process.env.CURSOR_API_KEY) {
    throw new Error("Set CURSOR_API_KEY for cloud Cursor SDK triage.");
  }

  mkdirSync(RUN_LOG_DIR, { recursive: true });
  const logPath = resolve(
    RUN_LOG_DIR,
    `${new Date().toISOString().replace(/[:.]/g, "-")}-triage.jsonl`
  );

  const { Agent, CursorSdkError } = await loadSdk();

  /** @type {string[]} */
  const summaryLines = [
    `Daily triage: ${records.length} unprocessed msg(s) → ${selected.length} agent run(s)`,
  ];
  /** @type {{ thread_id: string; pr_url?: string; notes?: string }[]} */
  const outcomes = [];

  for (const t of selected) {
    const bundle = {
      thread_id: t.key,
      summary_hint: null,
      repo_url: repoUrl,
      messages: t.messages.map((m) => ({
        update_id: m.update_id,
        message_id: m.message_id,
        text: m.text,
        ts: m.ts,
        reply_to_message_id: m.reply_to_message_id,
        from: m.from,
        media: m.media,
      })),
    };

    const userPrompt = `${promptTemplate}

---

## Feedback bundle

\`\`\`json
${JSON.stringify(bundle, null, 2)}
\`\`\`
`;

    const agent = await Agent.create({
      apiKey: process.env.CURSOR_API_KEY,
      model: { id: modelId },
      cloud: {
        repos: [{ url: repoUrl }],
        autoCreatePR: true,
        skipReviewerRequest: true,
      },
      name: `padel-feedback-${t.key.replace(/[^a-zA-Z0-9-_]/g, "-").slice(0, 48)}`,
    });

    /** @type {unknown[]} */
    const events = [];
    let fullText = "";

    try {
      const run = await agent.send(userPrompt);
      const rid = run?.id ?? "?";
      console.log(`[triage] Agent run started: ${rid} thread=${t.key}`);

      for await (const event of run.stream()) {
        events.push(event);
        appendFileSync(logPath, `${JSON.stringify(event)}\n`, "utf8");
        const line = summarizeStreamEvent(event);
        if (line) {
          process.stdout.write(line.startsWith("\n") ? line : `${line}\n`);
          if (event.type === "assistant") {
            const txt = event.message.content
              .filter((block) => block.type === "text")
              .map((block) => block.text)
              .join("");
            fullText += txt;
          }
        }
      }

      const result = await run.wait();
      events.push({ type: "result", result });
      appendFileSync(logPath, `${JSON.stringify({ type: "result", result })}\n`, "utf8");

      console.log(`\n[triage] Run finished: ${result.status} thread=${t.key}`);

      if (result.status === "error") {
        outcomes.push({
          thread_id: t.key,
          notes: `agent error status for run ${rid}`,
        });
        continue;
      }

      const prUrl = extractPrUrl(fullText);
      const footer = parseFeedbackFooter(fullText);
      outcomes.push({
        thread_id: t.key,
        pr_url: prUrl ?? undefined,
        notes: footer?.notes || footer?.clarification_question,
      });

      const ids = t.messages.map((m) => m.update_id);
      state = readState();
      const merged = new Set([
        ...state.processed_update_ids,
        ...ids,
      ]);
      writeState({
        ...state,
        processed_update_ids: [...merged].sort((a, b) => a - b),
        consumed_update_id: Math.max(
          state.consumed_update_id,
          ...ids
        ),
      });
    } catch (err) {
      const msg =
        err instanceof CursorSdkError ? err.message : String(err);
      console.error(`[triage] SDK error thread=${t.key}: ${msg}`);
      outcomes.push({ thread_id: t.key, notes: msg });
    } finally {
      agent.close();
    }
  }

  let prCount = 0;
  for (const o of outcomes) {
    const quote = o.thread_id.slice(0, 80);
    if (o.pr_url) {
      prCount += 1;
      summaryLines.push(`PR: ${quote} — ${o.pr_url}`);
    } else if (o.notes) {
      summaryLines.push(`Skipped / clarify (${quote}): ${o.notes}`);
    } else {
      summaryLines.push(`Done (${quote}): see Cursor dashboard for transcript`);
    }
  }

  if (deferredCount > 0) {
    summaryLines.push(
      `Deferred ${deferredCount} thread(s) (caps: ${maxMsgs} msgs, ${maxPrs} PRs).`
    );
  }

  summaryLines.push(`Run log: ${logPath}`);

  await sendTelegramSummary(token, chatId, summaryLines);
  console.log(`\n[triage] Summary posted to Telegram. Log: ${logPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
