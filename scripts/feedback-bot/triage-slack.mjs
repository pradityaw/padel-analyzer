#!/usr/bin/env node
/**
 * Drain Slack (collect), group threads, run cloud Cursor agents, post summary to Slack.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { collectSlackMessages } from "./collect-slack.mjs";
import { shouldSkipSlackRecord } from "./filter.mjs";
import { loadFeedbackEnv, repoRoot } from "./env.mjs";
import { mergeFeedbackPr, prNumberFromUrl } from "./lib/merge-feedback-pr.mjs";

const PROMPT_PATH = resolve(
  repoRoot,
  "scripts/cursor-sdk/prompts/feedback-implement.md"
);
const FEEDBACK_DIR = resolve(repoRoot, "qa-artifacts/feedback");
const STATE_PATH = resolve(FEEDBACK_DIR, "slack-state.json");
const INBOX_PATH = resolve(FEEDBACK_DIR, "slack-inbox.jsonl");
const RUN_LOG_DIR = resolve(repoRoot, ".cursor-sdk-runs/feedback");

const DEFAULT_REPO_URL = "https://github.com/pradityaw/padel-analyzer.git";

function compareTs(a, b) {
  const pa = String(a).split(".");
  const pb = String(b).split(".");
  const sa = BigInt(pa[0] || "0");
  const sb = BigInt(pb[0] || "0");
  if (sa !== sb) return sa < sb ? -1 : 1;
  const ma = BigInt((pa[1] || "0").padEnd(6, "0").slice(0, 6));
  const mb = BigInt((pb[1] || "0").padEnd(6, "0").slice(0, 6));
  if (ma === mb) return 0;
  return ma < mb ? -1 : 1;
}

function maxTsStrings(ids) {
  return ids.reduce((a, b) => (compareTs(a, b) >= 0 ? a : b), ids[0]);
}

function parseArgs(argv) {
  const args = { dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--help" || a === "-h") {
      console.log(`Usage: node scripts/feedback-bot/triage-slack.mjs [--dry-run]

Environment:
  CURSOR_API_KEY, SLACK_BOT_TOKEN, SLACK_FEEDBACK_CHANNEL_ID,
  SLACK_ALLOWLIST_USER_IDS (optional), FEEDBACK_REPO_URL (optional),
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
      oldest_ts: "0",
      consumed_ts: "0",
      processed_message_ids: [],
    };
  }
  try {
    const j = JSON.parse(readFileSync(STATE_PATH, "utf8"));
    return {
      oldest_ts: String(j.oldest_ts ?? "0"),
      consumed_ts: String(j.consumed_ts ?? "0"),
      processed_message_ids: Array.isArray(j.processed_message_ids)
        ? j.processed_message_ids.map(String)
        : [],
    };
  } catch {
    return {
      oldest_ts: "0",
      consumed_ts: "0",
      processed_message_ids: [],
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

async function slackApi(token, method, body = {}) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) {
    throw new Error(`Slack ${method} failed: ${json.error || JSON.stringify(json)}`);
  }
  return json;
}

async function sendSlackSummary(token, channelId, lines) {
  const text = lines.join("\n").slice(0, 3000);
  await slackApi(token, "chat.postMessage", {
    channel: channelId,
    text,
  });
}

async function sendSlackThreadReply(token, channelId, threadTs, text) {
  await slackApi(token, "chat.postMessage", {
    channel: channelId,
    thread_ts: threadTs,
    text: text.slice(0, 3000),
  });
}

async function loadSdk() {
  const sdk = await import("@cursor/sdk");
  return { Agent: sdk.Agent, CursorSdkError: sdk.CursorSdkError };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadFeedbackEnv();

  const token = process.env.SLACK_BOT_TOKEN;
  const channelId = process.env.SLACK_FEEDBACK_CHANNEL_ID;

  if (args.dryRun && !process.env.SLACK_BOT_TOKEN) {
    console.warn(
      "[triage-slack] dry-run: skipping Slack collect (set SLACK_BOT_TOKEN to drain new messages)"
    );
  } else {
    console.log("[triage-slack] Running collect...");
    const collectResult = await collectSlackMessages({ silent: true });
    console.log(
      `[triage-slack] collect appended=${collectResult.appended} oldest_ts=${collectResult.oldest_ts}`
    );
  }

  let state = readState();
  const processedSet = new Set(state.processed_message_ids);

  const maxMsgs = Number(process.env.FEEDBACK_MAX_MESSAGES_PER_RUN) || 100;
  const maxPrs = Number(process.env.FEEDBACK_MAX_PRS_PER_RUN) || 3;
  const repoUrl = process.env.FEEDBACK_REPO_URL || DEFAULT_REPO_URL;
  const modelId = process.env.FEEDBACK_MODEL || "composer-2";

  const allRecords = loadInboxRecords();
  const unprocessed = allRecords.filter(
    (r) => r.slack_ts && !processedSet.has(String(r.slack_ts))
  );

  const noise = unprocessed.filter((r) => shouldSkipSlackRecord(r));
  const records = unprocessed.filter((r) => !shouldSkipSlackRecord(r));

  if (noise.length > 0) {
    const skipIds = noise.map((r) => String(r.slack_ts));
    const merged = new Set([...state.processed_message_ids, ...skipIds]);
    const sorted = [...merged].sort((a, b) => compareTs(a, b));
    state = {
      ...state,
      processed_message_ids: sorted,
      consumed_ts: maxTsStrings([state.consumed_ts, ...skipIds]),
    };
    writeState(state);
    processedSet.clear();
    for (const id of state.processed_message_ids) processedSet.add(id);
    console.log(
      `[triage-slack] marked ${noise.length} setup/noise message(s) as processed (skipped)`
    );
  }

  if (records.length === 0) {
    console.log("[triage-slack] No unprocessed actionable inbox messages.");
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
    `[triage-slack] threads=${threadList.length} selected=${selected.length} deferred=${deferredCount} unprocessed_msgs=${records.length}`
  );

  if (args.dryRun) {
    for (const t of selected) {
      const bundle = {
        thread_id: t.key,
        summary_hint: null,
        repo_url: repoUrl,
        messages: t.messages.map((m) => ({
          slack_ts: m.slack_ts,
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

  if (!token || !channelId) {
    throw new Error(
      "Set SLACK_BOT_TOKEN and SLACK_FEEDBACK_CHANNEL_ID for Slack summary."
    );
  }

  if (selected.length === 0) {
    await sendSlackSummary(token, channelId, [
      `Daily triage: ${records.length} unprocessed msg(s) → 0 agent runs`,
      `No threads fit current caps (max ${maxMsgs} msgs, ${maxPrs} PRs/run). Deferred ${threadList.length} thread(s).`,
      `Increase FEEDBACK_MAX_MESSAGES_PER_RUN / FEEDBACK_MAX_PRS_PER_RUN or wait for the next run.`,
    ]);
    console.warn(
      `[triage-slack] Nothing selected under caps (threads=${threadList.length}).`
    );
    return;
  }

  if (!process.env.CURSOR_API_KEY) {
    throw new Error("Set CURSOR_API_KEY for cloud Cursor SDK triage.");
  }

  mkdirSync(RUN_LOG_DIR, { recursive: true });
  const logPath = resolve(
    RUN_LOG_DIR,
    `${new Date().toISOString().replace(/[:.]/g, "-")}-triage-slack.jsonl`
  );

  const { Agent, CursorSdkError } = await loadSdk();

  /** @type {string[]} */
  const summaryLines = [
    `Daily triage: ${records.length} unprocessed msg(s) → ${selected.length} agent run(s)`,
  ];
  /** @type {{ thread_id: string; pr_url?: string; notes?: string; thread_ts?: string; classification?: string }}[]} */
  const outcomes = [];

  for (const t of selected) {
    const bundle = {
      thread_id: t.key,
      summary_hint: null,
      repo_url: repoUrl,
      messages: t.messages.map((m) => ({
        slack_ts: m.slack_ts,
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
      name: `padel-feedback-slack-${t.key.replace(/[^a-zA-Z0-9-_]/g, "-").slice(0, 40)}`,
    });

    let fullText = "";

    try {
      const run = await agent.send(userPrompt);
      const rid = run?.id ?? "?";
      console.log(`[triage-slack] Agent run started: ${rid} thread=${t.key}`);

      const timeoutMs =
        Number(process.env.FEEDBACK_AGENT_TIMEOUT_MS) || 20 * 60 * 1000;
      const deadline = Date.now() + timeoutMs;
      let lastStatus = "unknown";

      for await (const event of run.stream()) {
        if (Date.now() > deadline) {
          throw new Error(
            `Agent run timed out after ${Math.round(timeoutMs / 60000)} min (run ${rid}, last status: ${lastStatus}). Check Cursor cloud agents dashboard.`
          );
        }
        if (event.type === "status") lastStatus = event.status;
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
      appendFileSync(logPath, `${JSON.stringify({ type: "result", result })}\n`, "utf8");

      console.log(`\n[triage-slack] Run finished: ${result.status} thread=${t.key}`);

      const rootTs = t.messages[0]?.slack_ts;

      if (result.status === "error") {
        outcomes.push({
          thread_id: t.key,
          notes: `agent error status for run ${rid}`,
          thread_ts: rootTs,
        });
        continue;
      }

      const prUrl = extractPrUrl(fullText);
      const footer = parseFeedbackFooter(fullText);
      const classification = footer?.classification || "";
      const clarification = footer?.clarification_question || "";

      outcomes.push({
        thread_id: t.key,
        pr_url: prUrl ?? undefined,
        notes: footer?.notes || clarification,
        thread_ts: rootTs,
        classification,
      });

      if (
        classification === "unclear" &&
        clarification &&
        rootTs &&
        token &&
        channelId
      ) {
        await sendSlackThreadReply(
          token,
          channelId,
          rootTs,
          `Need a bit more detail: ${clarification}`
        );
      }

      if (
        process.env.FEEDBACK_AUTO_MERGE === "1" &&
        prUrl &&
        ["bug", "ux", "feature"].includes(classification)
      ) {
        const prNumber = prNumberFromUrl(prUrl);
        if (prNumber) {
          try {
            const mergeResult = await mergeFeedbackPr(prNumber);
            console.log(`[triage-slack] auto-merged PR #${prNumber}`);
            if (mergeResult.sync?.pulled) {
              console.log(
                `[triage-slack] Expo dev sync → ${mergeResult.sync.shortSha}`
              );
            }
          } catch (err) {
            console.warn(
              `[triage-slack] auto-merge failed for ${prUrl}:`,
              err instanceof Error ? err.message : err
            );
          }
        }
      }

      const ids = t.messages.map((m) => String(m.slack_ts));
      state = readState();
      const merged = new Set([...state.processed_message_ids, ...ids]);
      const sorted = [...merged].sort((a, b) => compareTs(a, b));
      writeState({
        ...state,
        processed_message_ids: sorted,
        consumed_ts: maxTsStrings([state.consumed_ts, ...ids]),
      });
    } catch (err) {
      const msg =
        err instanceof CursorSdkError ? err.message : String(err);
      console.error(`[triage-slack] SDK error thread=${t.key}: ${msg}`);
      outcomes.push({
        thread_id: t.key,
        notes: msg,
        thread_ts: t.messages[0]?.slack_ts,
      });
    } finally {
      agent.close();
    }
  }

  for (const o of outcomes) {
    const quote = o.thread_id.slice(0, 80);
    if (o.pr_url) {
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

  await sendSlackSummary(token, channelId, summaryLines);
  console.log(`\n[triage-slack] Summary posted to Slack. Log: ${logPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
