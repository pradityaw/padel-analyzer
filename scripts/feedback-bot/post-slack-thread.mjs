#!/usr/bin/env node
/**
 * Post a message to a Slack feedback thread (by thread_id or slack_ts).
 *
 * Usage:
 *   node scripts/feedback-bot/post-slack-thread.mjs --thread-id burst-1779203975.053489 --text "..."
 *   node scripts/feedback-bot/post-slack-thread.mjs --slack-ts 1779203975.053489 --text "..."
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadFeedbackEnv, repoRoot } from "./env.mjs";

const INBOX_PATH = resolve(repoRoot, "qa-artifacts/feedback/slack-inbox.jsonl");

function parseArgs(argv) {
  /** @type {{ threadId?: string; slackTs?: string; text?: string; channel?: boolean }} */
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--thread-id") out.threadId = argv[++i];
    else if (a === "--slack-ts") out.slackTs = argv[++i];
    else if (a === "--text") out.text = argv[++i];
    else if (a === "--channel") out.channel = true;
    else if (a === "--help" || a === "-h") {
      console.log(`Usage:
  post-slack-thread.mjs --thread-id <burst-...|reply-...> --text "message"
  post-slack-thread.mjs --slack-ts <ts> --text "message"
  post-slack-thread.mjs --channel --text "message"   # top-level channel post
`);
      process.exit(0);
    }
  }
  return out;
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

function resolveSlackTsFromThreadId(threadId) {
  const burst = threadId.match(/^burst-(.+)$/);
  if (burst) return burst[1];

  const reply = threadId.match(/^reply-(\d+(?:\.\d+)?)$/);
  if (reply) {
    const rootMessageId = Number(reply[1]);
    if (!existsSync(INBOX_PATH)) {
      throw new Error(
        `No ${INBOX_PATH}; run feedback:collect-slack or pass --slack-ts`
      );
    }
    const lines = readFileSync(INBOX_PATH, "utf8")
      .split(/\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    for (const line of lines) {
      const r = JSON.parse(line);
      if (r.message_id === rootMessageId || r.update_id === rootMessageId) {
        return String(r.slack_ts);
      }
    }
    throw new Error(`No inbox row for reply thread root message_id=${reply[1]}`);
  }

  throw new Error(`Unknown thread_id format: ${threadId}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadFeedbackEnv();

  const token = process.env.SLACK_BOT_TOKEN;
  const channelId = process.env.SLACK_FEEDBACK_CHANNEL_ID;
  if (!token || !channelId) {
    throw new Error("Set SLACK_BOT_TOKEN and SLACK_FEEDBACK_CHANNEL_ID in .env.feedback");
  }
  if (!args.text?.trim()) {
    throw new Error("Pass --text with the message body");
  }

  const body = {
    channel: channelId,
    text: args.text.trim().slice(0, 3000),
  };

  if (!args.channel) {
    let slackTs = args.slackTs;
    if (!slackTs && args.threadId) {
      slackTs = resolveSlackTsFromThreadId(args.threadId);
    }
    if (!slackTs) {
      throw new Error("Pass --slack-ts, --thread-id, or --channel");
    }
    body.thread_ts = slackTs;
  }

  const json = await slackApi(token, "chat.postMessage", body);
  console.log(
    `[post-slack-thread] posted ts=${json.ts}${body.thread_ts ? ` thread=${body.thread_ts}` : " (channel)"}`
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
