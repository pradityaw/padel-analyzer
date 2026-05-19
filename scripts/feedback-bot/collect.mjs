#!/usr/bin/env node
/**
 * Drain Telegram updates into qa-artifacts/feedback/inbox.jsonl.
 * Reacts with 👀 on captured messages (Bot API 7+).
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
import { loadFeedbackEnv, repoRoot } from "./env.mjs";

const FEEDBACK_DIR = resolve(repoRoot, "qa-artifacts/feedback");
const STATE_PATH = resolve(FEEDBACK_DIR, "state.json");
const INBOX_PATH = resolve(FEEDBACK_DIR, "inbox.jsonl");
const MEDIA_DIR = resolve(FEEDBACK_DIR, "media");

const MAX_DRAIN_ITERATIONS = 50;

function readState() {
  if (!existsSync(STATE_PATH)) {
    return {
      last_update_id: 0,
      consumed_update_id: 0,
      processed_update_ids: [],
    };
  }
  try {
    const raw = readFileSync(STATE_PATH, "utf8");
    const j = JSON.parse(raw);
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

function writeState(partial) {
  const prev = readState();
  const next = { ...prev, ...partial };
  mkdirSync(FEEDBACK_DIR, { recursive: true });
  writeFileSync(STATE_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

function parseAllowlist() {
  const raw = process.env.TELEGRAM_ALLOWLIST_USER_IDS;
  if (!raw || !String(raw).trim()) return null;
  return new Set(
    String(raw)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

function tgApi(token, method) {
  return `https://api.telegram.org/bot${token}/${method}`;
}

async function tgFetch(token, method, params = {}) {
  const url = new URL(tgApi(token, method));
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url);
  const json = await res.json();
  if (!json.ok) {
    throw new Error(
      `Telegram ${method} failed: ${json.description || JSON.stringify(json)}`
    );
  }
  return json.result;
}

async function tgPostJson(token, method, body) {
  const res = await fetch(tgApi(token, method), {
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

function normalizeChatId(id) {
  return String(id);
}

function extractMessage(update) {
  return (
    update.message ||
    update.edited_message ||
    update.channel_post ||
    update.edited_channel_post ||
    null
  );
}

function pickPhotoFileId(message) {
  const photos = message.photo;
  if (!photos || !photos.length) return null;
  return photos[photos.length - 1].file_id;
}

async function downloadTelegramFile(token, fileId, destAbsPath) {
  const meta = await tgFetch(token, "getFile", { file_id: fileId });
  const filePath = meta.file_path;
  if (!filePath) throw new Error("getFile missing file_path");
  const fileUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;
  const res = await fetch(fileUrl);
  if (!res.ok) throw new Error(`download failed ${res.status}`);
  mkdirSync(dirname(destAbsPath), { recursive: true });
  await pipeline(
    /** @type {import('node:stream').Readable} */ (res.body),
    createWriteStream(destAbsPath)
  );
  return destAbsPath;
}

async function setReaction(token, chatId, messageId, silent) {
  try {
    await tgPostJson(token, "setMessageReaction", {
      chat_id: chatId,
      message_id: messageId,
      reaction: [{ type: "emoji", emoji: "👀" }],
    });
  } catch (e) {
    if (!silent) {
      console.warn(
        `[collect] setMessageReaction skipped: ${e instanceof Error ? e.message : e}`
      );
    }
  }
}

/**
 * @param {{ silent?: boolean }} opts
 * @returns {Promise<{ appended: number, last_update_id: number }>}
 */
export async function collectMessages(opts = {}) {
  loadFeedbackEnv();
  const silent = !!opts.silent;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatIdEnv = process.env.TELEGRAM_FEEDBACK_CHAT_ID;
  if (!token || !chatIdEnv) {
    throw new Error(
      "Set TELEGRAM_BOT_TOKEN and TELEGRAM_FEEDBACK_CHAT_ID (see scripts/feedback-bot/README.md)"
    );
  }

  const targetChat = normalizeChatId(chatIdEnv);
  const allowlist = parseAllowlist();
  mkdirSync(FEEDBACK_DIR, { recursive: true });
  mkdirSync(MEDIA_DIR, { recursive: true });

  let state = readState();
  let appended = 0;
  let iteration = 0;

  while (iteration < MAX_DRAIN_ITERATIONS) {
    iteration += 1;
    const offset =
      state.last_update_id > 0 ? state.last_update_id + 1 : undefined;
    /** @type {Record<string, string | number | undefined>} */
    const params = { timeout: 30, limit: 100 };
    if (offset !== undefined) params.offset = offset;

    const updates = await tgFetch(token, "getUpdates", params);
    if (!updates?.length) break;

    for (const update of updates) {
      const uid = update.update_id;
      state = readState();
      const nextLast = Math.max(state.last_update_id, uid);
      writeState({ last_update_id: nextLast });

      const msg = extractMessage(update);
      if (!msg) continue;

      const chat = msg.chat;
      if (!chat || normalizeChatId(chat.id) !== targetChat) continue;

      const from = msg.from;
      if (!from) continue;

      if (allowlist && !allowlist.has(String(from.id))) continue;

      const text = msg.text || msg.caption || "";
      const messageId = msg.message_id;
      const replyToId = msg.reply_to_message?.message_id ?? null;

      /** @type {Array<{ kind: string; path: string }>} */
      const media = [];

      const photoId = pickPhotoFileId(msg);
      if (photoId) {
        const name = `${uid}-${messageId}-photo.jpg`;
        const dest = resolve(MEDIA_DIR, name);
        await downloadTelegramFile(token, photoId, dest);
        media.push({ kind: "photo", path: dest });
      }

      if (msg.video?.file_id) {
        const ext = msg.video.mime_type?.includes("mp4") ? "mp4" : "bin";
        const name = `${uid}-${messageId}-video.${ext}`;
        const dest = resolve(MEDIA_DIR, name);
        await downloadTelegramFile(token, msg.video.file_id, dest);
        media.push({ kind: "video", path: dest });
      }

      const record = {
        update_id: uid,
        message_id: messageId,
        chat_id: chat.id,
        date: msg.date,
        from: {
          id: from.id,
          is_bot: from.is_bot,
          first_name: from.first_name,
          username: from.username,
        },
        text,
        reply_to_message_id: replyToId,
        media: media.map((m) => ({
          kind: m.kind,
          path: m.path.replace(repoRoot + "/", ""),
        })),
        ts: new Date((msg.date || 0) * 1000).toISOString(),
      };

      appendFileSync(INBOX_PATH, `${JSON.stringify(record)}\n`, "utf8");
      appended += 1;

      await setReaction(token, chat.id, messageId, silent);
    }

    if (updates.length < 100) break;
  }

  return { appended, last_update_id: readState().last_update_id };
}

async function main() {
  const r = await collectMessages({ silent: false });
  console.log(
    `[collect] appended ${r.appended} message(s); last_update_id=${r.last_update_id}`
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
