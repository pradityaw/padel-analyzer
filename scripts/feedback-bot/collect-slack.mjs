#!/usr/bin/env node
/**
 * Drain Slack channel history into qa-artifacts/feedback/slack-inbox.jsonl.
 * Reacts with :eyes: on captured messages.
 */
import { createWriteStream } from "node:fs";
import {
  existsSync,
  mkdirSync,
  appendFileSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { shouldSkipSlackRecord } from "./filter.mjs";
import { loadFeedbackEnv, repoRoot } from "./env.mjs";
import {
  resolveSlackChannelId,
  slackApi,
  SlackApiError,
  slackErrorHint,
} from "./slack.mjs";

const FEEDBACK_DIR = resolve(repoRoot, "qa-artifacts/feedback");
const STATE_PATH = resolve(FEEDBACK_DIR, "slack-state.json");
const INBOX_PATH = resolve(FEEDBACK_DIR, "slack-inbox.jsonl");
const MEDIA_DIR = resolve(FEEDBACK_DIR, "media");

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

function writeState(partial) {
  const prev = readState();
  const next = { ...prev, ...partial };
  mkdirSync(FEEDBACK_DIR, { recursive: true });
  writeFileSync(STATE_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

function parseAllowlist() {
  const raw = process.env.SLACK_ALLOWLIST_USER_IDS;
  if (!raw || !String(raw).trim()) return null;
  return new Set(
    String(raw)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

function loadExistingSlackTs() {
  if (!existsSync(INBOX_PATH)) return new Set();
  const set = new Set();
  for (const line of readFileSync(INBOX_PATH, "utf8").split(/\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      const r = JSON.parse(t);
      if (r.slack_ts) set.add(String(r.slack_ts));
    } catch {
      /* ignore bad lines */
    }
  }
  return set;
}

function nextOldestTs(ts) {
  const parts = String(ts).split(".");
  const sec = parts[0] || "0";
  const micro = (parts[1] || "0").padEnd(6, "0");
  const n = BigInt(sec) * 1000000n + BigInt(micro.slice(0, 6)) + 1n;
  const newSec = n / 1000000n;
  const newMicro = n % 1000000n;
  return `${newSec}.${String(newMicro).padStart(6, "0")}`;
}

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

function maxTs(a, b) {
  return compareTs(a, b) >= 0 ? a : b;
}

async function downloadSlackFile(token, url, destAbsPath) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Slack file download failed ${res.status}`);
  mkdirSync(dirname(destAbsPath), { recursive: true });
  await pipeline(
    /** @type {import('node:stream').Readable} */ (res.body),
    createWriteStream(destAbsPath)
  );
  return destAbsPath;
}

function pickFileExt(file) {
  const mime = file.mimetype || "";
  if (mime.includes("png")) return "png";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("webm")) return "webm";
  const name = file.name || "";
  const m = name.match(/\.([a-z0-9]+)$/i);
  return m ? m[1] : "bin";
}

/**
 * @param {object} msg
 * @param {string} channelId
 * @param {string} token
 * @param {Set<string>} seen
 * @returns {Promise<object | null>}
 */
async function messageToRecord(msg, channelId, token, seen) {
  if (!msg?.ts || seen.has(msg.ts)) return null;
  if (msg.subtype && msg.subtype !== "file_share") return null;
  if (!msg.user) return null;

  const allowlist = parseAllowlist();
  if (allowlist && !allowlist.has(String(msg.user))) return null;

  const text = msg.text || "";
  const hasFiles = Array.isArray(msg.files) && msg.files.length > 0;
  if (shouldSkipSlackRecord({ text, media: hasFiles ? [{}] : [] })) return null;

  /** @type {Array<{ kind: string; path: string }>} */
  const media = [];
  if (Array.isArray(msg.files)) {
    for (const file of msg.files) {
      const url = file.url_private_download || file.url_private;
      if (!url) continue;
      const ext = pickFileExt(file);
      const kind = (file.mimetype || "").startsWith("video/") ? "video" : "image";
      const safeTs = String(msg.ts).replace(".", "_");
      const dest = resolve(MEDIA_DIR, `slack-${safeTs}-${file.id || "file"}.${ext}`);
      await downloadSlackFile(token, url, dest);
      media.push({
        kind,
        path: dest.replace(repoRoot + "/", ""),
      });
    }
  }

  const tsFloat = parseFloat(msg.ts);
  const replyParent =
    msg.thread_ts && msg.thread_ts !== msg.ts
      ? parseFloat(msg.thread_ts)
      : null;

  return {
    slack_ts: msg.ts,
    update_id: tsFloat,
    message_id: tsFloat,
    chat_id: channelId,
    date: Math.round(tsFloat),
    from: { id: msg.user },
    text: msg.text || "",
    reply_to_message_id: replyParent,
    media,
    ts: new Date(tsFloat * 1000).toISOString(),
  };
}

async function addReaction(token, channelId, ts, silent) {
  try {
    await slackApi(token, "reactions.add", {
      channel: channelId,
      timestamp: ts,
      name: "eyes",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("already_reacted")) return;
    if (!silent) console.warn(`[collect-slack] reactions.add skipped: ${msg}`);
  }
}

/**
 * Timestamp to pass to conversations.replies (thread parent only).
 * @param {object} msg
 * @returns {string | null}
 */
function threadParentTs(msg) {
  const ts = msg?.ts != null ? String(msg.ts) : "";
  if (!ts) return null;
  const threadTs = msg.thread_ts != null ? String(msg.thread_ts) : null;
  if (threadTs && threadTs !== ts) return null;
  return threadTs || ts;
}

/**
 * @param {object} opts
 * @param {string} opts.token
 * @param {string} opts.channelId
 * @param {string} opts.parentTs
 */
async function fetchThreadReplies({ token, channelId, parentTs }) {
  try {
    return await slackApi(token, "conversations.replies", {
      channel: channelId,
      ts: parentTs,
      limit: 200,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(
      `[collect-slack] conversations.replies skipped (ts=${parentTs}): ${msg}`
    );
    return { messages: [] };
  }
}

/**
 * @param {object} record
 */
function appendRecord(record) {
  appendFileSync(INBOX_PATH, `${JSON.stringify(record)}\n`, "utf8");
}

/**
 * @param {{ silent?: boolean }} opts
 * @returns {Promise<{ appended: number; oldest_ts: string }>}
 */
export async function collectSlackMessages(opts = {}) {
  loadFeedbackEnv();
  const silent = !!opts.silent;
  const token = process.env.SLACK_BOT_TOKEN;
  const rawChannelId = process.env.SLACK_FEEDBACK_CHANNEL_ID;
  if (!token || !rawChannelId) {
    throw new Error(
      "Set SLACK_BOT_TOKEN and SLACK_FEEDBACK_CHANNEL_ID (see scripts/feedback-bot/README.md)"
    );
  }
  const channelId = await resolveSlackChannelId(token, rawChannelId, {
    log: (msg) => {
      if (!silent) console.warn(`[collect-slack] ${msg}`);
    },
  });

  mkdirSync(FEEDBACK_DIR, { recursive: true });
  mkdirSync(MEDIA_DIR, { recursive: true });

  const seen = loadExistingSlackTs();
  const fetchedThreads = new Set();
  let state = readState();
  let appended = 0;
  let maxSeenTs = state.oldest_ts;

  /**
   * @param {string} threadTs
   * @param {string} parentTs
   */
  async function ingestThreadReplies(threadTs, parentTs) {
    if (fetchedThreads.has(threadTs)) return;
    fetchedThreads.add(threadTs);

    let repliesPage;
    try {
      repliesPage = await slackApi(token, "conversations.replies", {
        channel: channelId,
        ts: threadTs,
        limit: 200,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!silent) {
        console.warn(
          `[collect-slack] conversations.replies skipped for ts=${threadTs}: ${msg}`
        );
      }
      return;
    }

    for (const reply of repliesPage.messages || []) {
      if (String(reply.ts) === threadTs) continue;
      const replyRecord = await messageToRecord(reply, channelId, token, seen);
      if (!replyRecord) continue;
      replyRecord.reply_to_message_id = parseFloat(parentTs);
      seen.add(replyRecord.slack_ts);
      appendRecord(replyRecord);
      appended += 1;
      maxSeenTs = maxTs(maxSeenTs, replyRecord.slack_ts);
      await addReaction(token, channelId, replyRecord.slack_ts, silent);
    }
  }

  let cursor;
  do {
    /** @type {Record<string, string | number | undefined>} */
    const body = {
      channel: channelId,
      oldest: state.oldest_ts,
      limit: 200,
    };
    if (cursor) body.cursor = cursor;

    let page;
    try {
      page = await slackApi(token, "conversations.history", body);
    } catch (e) {
      if (e instanceof SlackApiError) {
        throw new Error(`${e.message}. ${slackErrorHint(e.method, e.error)}`);
      }
      throw e;
    }
    const messages = page.messages || [];
    cursor = page.response_metadata?.next_cursor;

    for (const msg of messages) {
      const threadTs = String(msg.thread_ts || msg.ts || "");
      const isThreadParent =
        !!threadTs && (!msg.thread_ts || String(msg.thread_ts) === String(msg.ts));
      const replyCount = Number(msg.reply_count) || 0;
      if (isThreadParent && replyCount > 0) {
        await ingestThreadReplies(threadTs, threadTs);
      }

      const record = await messageToRecord(msg, channelId, token, seen);
      if (!record) continue;

      seen.add(record.slack_ts);
      appendRecord(record);
      appended += 1;
      maxSeenTs = maxTs(maxSeenTs, record.slack_ts);
      await addReaction(token, channelId, record.slack_ts, silent);
    }
  } while (cursor);

  if (appended > 0 || compareTs(maxSeenTs, state.oldest_ts) > 0) {
    const newOldest =
      compareTs(maxSeenTs, state.oldest_ts) > 0
        ? nextOldestTs(maxSeenTs)
        : state.oldest_ts;
    writeState({ oldest_ts: newOldest });
    maxSeenTs = newOldest;
  }

  return { appended, oldest_ts: readState().oldest_ts };
}

async function main() {
  const r = await collectSlackMessages({ silent: false });
  console.log(
    `[collect-slack] appended ${r.appended} message(s); oldest_ts=${r.oldest_ts}`
  );
}

const isMain =
  !!process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
