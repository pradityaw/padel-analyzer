/**
 * Cursor cloud agent runner for Slack feedback bundles.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { extname, resolve } from "node:path";
import { repoRoot } from "../env.mjs";
import { mergeFeedbackPr, prNumberFromUrl } from "./merge-feedback-pr.mjs";
import { RUN_LOG_DIR } from "./slack-state.mjs";

export const DEFAULT_REPO_URL = "https://github.com/pradityaw/padel-analyzer.git";
const PROMPT_PATH = resolve(
  repoRoot,
  "scripts/cursor-sdk/prompts/feedback-implement.md"
);

export function loadPromptTemplate() {
  if (!existsSync(PROMPT_PATH)) return "";
  return readFileSync(PROMPT_PATH, "utf8").trim();
}

export function parseFeedbackFooter(fullText) {
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

export function extractPrUrl(text) {
  const footer = parseFeedbackFooter(text);
  if (footer?.pr_url?.startsWith("http")) return footer.pr_url;
  const m = text.match(/https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/);
  return m ? m[0] : null;
}

const MAX_PROMPT_IMAGES = 4;
const MAX_PROMPT_IMAGE_BYTES = 8 * 1024 * 1024;

function mimeTypeFromPath(filePath) {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  return null;
}

function loadPromptImages(bundle) {
  const media = Array.isArray(bundle.media)
    ? bundle.media
    : Array.isArray(bundle.messages)
      ? bundle.messages.flatMap((message) =>
          Array.isArray(message.media) ? message.media : []
        )
      : [];

  const images = [];
  for (const item of media) {
    if (images.length >= MAX_PROMPT_IMAGES) break;
    if (item?.kind !== "image" || !item.path) continue;

    const imagePath = resolve(repoRoot, item.path);
    if (!existsSync(imagePath)) continue;

    const size = statSync(imagePath).size;
    if (size > MAX_PROMPT_IMAGE_BYTES) {
      console.warn(
        `[slack-agent] skipping large image attachment (${size} bytes): ${item.path}`
      );
      continue;
    }

    const mimeType = mimeTypeFromPath(imagePath);
    if (!mimeType) continue;

    images.push({
      data: readFileSync(imagePath).toString("base64"),
      mimeType,
    });
  }
  return images;
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

/**
 * @param {object} bundle
 * @param {{ logPath?: string; logToStdout?: boolean }} opts
 */
export async function runAgentOnBundle(bundle, opts = {}) {
  const apiKey = process.env.CURSOR_API_KEY;
  if (!apiKey) {
    throw new Error("Set CURSOR_API_KEY for cloud Cursor SDK triage.");
  }

  const repoUrl = process.env.FEEDBACK_REPO_URL || DEFAULT_REPO_URL;
  const modelId = process.env.FEEDBACK_MODEL || "composer-2";
  const promptTemplate = loadPromptTemplate();
  const threadKey = String(bundle.thread_id || "feedback");

  const userPrompt = `${promptTemplate}

---

## Feedback bundle

\`\`\`json
${JSON.stringify(bundle, null, 2)}
\`\`\`
`;
  const images = loadPromptImages(bundle);
  if (images.length > 0) {
    console.log(
      `[slack-agent] attached ${images.length} image(s) to SDK prompt for thread=${threadKey}`
    );
  } else if (
    (Array.isArray(bundle.media) && bundle.media.some((m) => m?.kind === "image")) ||
    (Array.isArray(bundle.messages) &&
      bundle.messages.some((m) =>
        Array.isArray(m.media) && m.media.some((item) => item?.kind === "image")
      ))
  ) {
    console.warn(
      `[slack-agent] bundle had image media but none were attached to SDK prompt (thread=${threadKey})`
    );
  }

  mkdirSync(RUN_LOG_DIR, { recursive: true });
  const logPath =
    opts.logPath ??
    resolve(
      RUN_LOG_DIR,
      `${new Date().toISOString().replace(/[:.]/g, "-")}-slack-agent.jsonl`
    );

  const sdk = await import("@cursor/sdk");
  const { Agent, CursorSdkError } = sdk;

  const agent = await Agent.create({
    apiKey,
    model: { id: modelId },
    cloud: {
      repos: [{ url: repoUrl }],
      autoCreatePR: true,
      skipReviewerRequest: true,
    },
    name: `padel-feedback-slack-${threadKey.replace(/[^a-zA-Z0-9-_]/g, "-").slice(0, 40)}`,
  });

  const startedAt = Date.now();
  let fullText = "";
  let runId = "?";

  try {
    const run = await agent.send(
      images.length > 0 ? { text: userPrompt, images } : userPrompt
    );
    runId = run?.id ?? "?";

    const timeoutMs =
      Number(process.env.FEEDBACK_AGENT_TIMEOUT_MS) || 20 * 60 * 1000;
    const deadline = Date.now() + timeoutMs;
    let lastStatus = "unknown";

    for await (const event of run.stream()) {
      if (Date.now() > deadline) {
        throw new Error(
          `Agent run timed out after ${Math.round(timeoutMs / 60000)} min (run ${runId}, last status: ${lastStatus}). Check Cursor cloud agents dashboard.`
        );
      }
      if (event.type === "status") lastStatus = event.status;
      appendFileSync(logPath, `${JSON.stringify(event)}\n`, "utf8");
      const line = summarizeStreamEvent(event);
      if (line && opts.logToStdout !== false) {
        process.stdout.write(line.startsWith("\n") ? line : `${line}\n`);
        if (event.type === "assistant") {
          const txt = event.message.content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("");
          fullText += txt;
        }
      } else if (event.type === "assistant") {
        const txt = event.message.content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("");
        fullText += txt;
      }
    }

    const result = await run.wait();
    appendFileSync(logPath, `${JSON.stringify({ type: "result", result })}\n`, "utf8");

    const durationMs = Date.now() - startedAt;
    const prUrl = extractPrUrl(fullText);
    const footer = parseFeedbackFooter(fullText);
    let merged = false;
    let mergeError;
    let outcomeNotes = "";

    if (
      process.env.FEEDBACK_AUTO_MERGE === "1" &&
      prUrl &&
      footer?.classification &&
      ["bug", "ux", "feature"].includes(footer.classification)
    ) {
      const prNumber = prNumberFromUrl(prUrl);
      if (prNumber) {
        try {
          const mergeResult = await mergeFeedbackPr(prNumber);
          merged = true;
          if (mergeResult.sync?.pulled) {
            outcomeNotes = `Synced dev workspace to ${mergeResult.sync.shortSha} for Expo Go.`;
          }
        } catch (err) {
          mergeError =
            err instanceof Error ? err.message : String(err);
          console.warn(`[slack-agent] auto-merge failed for ${prUrl}:`, mergeError);
        }
      }
    }

    return {
      ok: result.status !== "error",
      runId,
      status: result.status,
      prUrl: prUrl ?? undefined,
      merged,
      mergeError,
      devSyncNotes: outcomeNotes,
      classification: footer?.classification || "",
      notes: footer?.notes || "",
      clarification: footer?.clarification_question || "",
      durationMs,
      logPath,
      error:
        result.status === "error"
          ? `agent error status for run ${runId}`
          : undefined,
    };
  } catch (err) {
    const msg = err instanceof CursorSdkError ? err.message : String(err);
    return {
      ok: false,
      runId,
      status: "error",
      durationMs: Date.now() - startedAt,
      logPath,
      error: msg,
    };
  } finally {
    agent.close();
  }
}

/**
 * @param {import('./slack-agent.mjs').runAgentOnBundle extends (...args: any) => Promise<infer R> ? R : never} outcome
 */
export function formatThreadCompletionReport(outcome) {
  const mins = Math.round((outcome.durationMs ?? 0) / 60000);
  if (!outcome.ok) {
    return [
      ":x: *Feedback job failed*",
      outcome.error || "Unknown error",
      `Run id: \`${outcome.runId}\``,
      mins > 0 ? `Duration: ~${mins} min` : "",
      "You can retry with `npm run feedback:triage-slack` or post again.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  const lines = [
    ":white_check_mark: *Feedback job finished*",
    outcome.prUrl ? `*PR:* ${outcome.prUrl}` : "*PR:* none opened (see Cursor dashboard)",
  ];
  if (outcome.merged) {
    lines.push("*Merged:* squash-merged into the default branch.");
    if (outcome.devSyncNotes) lines.push(outcome.devSyncNotes);
    else {
      lines.push(
        "_Tip: run `npm run dev:mobile` on your Mac to auto-pull + reload Expo Go after each job._"
      );
    }
  } else if (outcome.mergeError) {
    lines.push(`*Merge:* failed — ${outcome.mergeError}`);
  }
  if (outcome.classification) {
    lines.push(`*Type:* ${outcome.classification}`);
  }
  if (outcome.classification === "unclear" && outcome.clarification) {
    lines.push(`*Question:* ${outcome.clarification}`);
  }
  if (outcome.notes) {
    lines.push(`*Notes:* ${outcome.notes}`);
  }
  if (mins > 0) {
    lines.push(`Duration: ~${mins} min`);
  }
  if (outcome.logPath) {
    lines.push(`Log: \`${outcome.logPath}\``);
  }
  return lines.join("\n");
}

/**
 * @param {Array<object>} messages
 * @param {string} threadId
 */
export function buildBundleFromMessages(messages, threadId) {
  const repoUrl = process.env.FEEDBACK_REPO_URL || DEFAULT_REPO_URL;
  return {
    thread_id: threadId,
    summary_hint: null,
    repo_url: repoUrl,
    messages: messages.map((m) => ({
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
}
