/**
 * Build inbox records from Slack Events API message payloads.
 */
import { createWriteStream, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { shouldSkipSlackRecord } from "../filter.mjs";
import { repoRoot } from "../env.mjs";
import { isAllowlistedUser, slackApi } from "./slack-api.mjs";
import { FEEDBACK_DIR } from "./slack-state.mjs";

const MEDIA_DIR = resolve(FEEDBACK_DIR, "media");

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

/**
 * @param {object} event — Slack message event
 * @param {string} channelId
 * @param {string} token
 */
export async function recordFromSlackEvent(event, channelId, token) {
  if (!event?.ts || !event?.user) return null;
  if (event.bot_id || event.bot_profile) return null;
  if (event.subtype && event.subtype !== "file_share") return null;
  if (!isAllowlistedUser(event.user)) return null;

  const text = event.text || "";
  const hasFiles = Array.isArray(event.files) && event.files.length > 0;
  if (shouldSkipSlackRecord({ text, media: hasFiles ? [{}] : [] })) return null;

  mkdirSync(MEDIA_DIR, { recursive: true });
  /** @type {Array<{ kind: string; path: string }>} */
  const media = [];

  if (Array.isArray(event.files)) {
    for (const file of event.files) {
      const url = file.url_private_download || file.url_private;
      if (!url) continue;
      const ext = pickFileExt(file);
      const kind = (file.mimetype || "").startsWith("video/") ? "video" : "image";
      const safeTs = String(event.ts).replace(".", "_");
      const dest = resolve(MEDIA_DIR, `slack-${safeTs}-${file.id || "file"}.${ext}`);
      await downloadSlackFile(token, url, dest);
      media.push({
        kind,
        path: dest.replace(repoRoot + "/", ""),
      });
    }
  }

  const tsFloat = parseFloat(event.ts);
  const replyParent =
    event.thread_ts && event.thread_ts !== event.ts
      ? parseFloat(event.thread_ts)
      : null;

  return {
    slack_ts: event.ts,
    update_id: tsFloat,
    message_id: tsFloat,
    chat_id: channelId,
    date: Math.round(tsFloat),
    from: { id: event.user },
    text: event.text || "",
    reply_to_message_id: replyParent,
    media,
    ts: new Date(tsFloat * 1000).toISOString(),
  };
}

/**
 * Fetch full message when Events API payload lacks files (e.g. only file_id).
 * @param {string} channelId
 * @param {string} messageTs
 * @param {string} token
 */
export async function fetchSlackMessage(channelId, messageTs, token) {
  const page = await slackApi(token, "conversations.history", {
    channel: channelId,
    latest: messageTs,
    oldest: messageTs,
    inclusive: true,
    limit: 1,
  });
  return page.messages?.[0] ?? null;
}
