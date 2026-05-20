/**
 * Slack Events API → real-time Cursor cloud agent feedback pipeline.
 */
import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Express, Request, Response } from "express";
import express from "express";

const REPLAY_WINDOW_SEC = 60 * 5;

function loadFeedbackEnvFile(): void {
  const envPath = path.join(process.cwd(), ".env.feedback");
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function verifySlackSignature(
  signingSecret: string,
  timestamp: string,
  rawBody: string,
  signature: string
): boolean {
  const ts = parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) return false;
  const age = Math.floor(Date.now() / 1000) - ts;
  if (age > REPLAY_WINDOW_SEC) return false;

  const base = `v0:${timestamp}:${rawBody}`;
  const expected =
    "v0=" +
    crypto.createHmac("sha256", signingSecret).update(base).digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "utf8"),
      Buffer.from(signature, "utf8")
    );
  } catch {
    return false;
  }
}

type SlackEventPayload = {
  type?: string;
  challenge?: string;
  event_id?: string;
  event?: {
    type?: string;
    subtype?: string;
    channel?: string;
    user?: string;
    text?: string;
    ts?: string;
    thread_ts?: string;
    bot_id?: string;
    bot_profile?: unknown;
    files?: unknown[];
  };
};

async function loadFeedbackModules() {
  const root = process.cwd();
  const envUrl = pathToFileURL(
    path.join(root, "scripts/feedback-bot/env.mjs")
  ).href;
  const realtimeUrl = pathToFileURL(
    path.join(root, "scripts/feedback-bot/lib/slack-realtime.mjs")
  ).href;
  const eventRecordUrl = pathToFileURL(
    path.join(root, "scripts/feedback-bot/lib/slack-event-record.mjs")
  ).href;

  const envMod = await import(envUrl);
  envMod.loadFeedbackEnv();

  const realtime = await import(realtimeUrl);
  const eventRecord = await import(eventRecordUrl);
  return { ...realtime, ...eventRecord };
}

async function handleMessageEvent(
  payload: SlackEventPayload,
  eventId: string | undefined
): Promise<void> {
  const event = payload.event;
  if (!event?.ts || !event.user) return;
  if (event.type !== "message") return;
  if (event.bot_id || event.bot_profile) return;
  if (event.subtype && event.subtype !== "file_share") return;

  const channelId = process.env.SLACK_FEEDBACK_CHANNEL_ID;
  const token = process.env.SLACK_BOT_TOKEN;
  if (!channelId || !token) {
    console.warn("[slack-events] missing SLACK_BOT_TOKEN or SLACK_FEEDBACK_CHANNEL_ID");
    return;
  }

  if (event.channel && event.channel !== channelId) {
    return;
  }

  const { recordFromSlackEvent, fetchSlackMessage, processRealtimeSlackFeedback } =
    await loadFeedbackModules();

  let msg = event;
  if (
    (!event.files || event.files.length === 0) &&
    event.text &&
    /upload|screenshot|video|image|attach/i.test(event.text)
  ) {
    const full = await fetchSlackMessage(channelId, event.ts, token);
    if (full) msg = full;
  }

  const record = await recordFromSlackEvent(msg, channelId, token);
  if (!record) {
    console.log("[slack-events] message ignored (filtered or invalid)");
    return;
  }

  const threadTs = event.thread_ts || event.ts;
  await processRealtimeSlackFeedback(record, {
    eventId,
    channelId,
    threadTs,
  });
}

export function registerSlackFeedbackRoutes(app: Express): void {
  loadFeedbackEnvFile();

  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    console.log(
      "[slack-events] SLACK_SIGNING_SECRET not set — /api/slack/events disabled"
    );
    return;
  }

  app.post(
    "/api/slack/events",
    express.raw({ type: "application/json", limit: "1mb" }),
    (req: Request, res: Response) => {
      const rawBody =
        req.body instanceof Buffer
          ? req.body.toString("utf8")
          : typeof req.body === "string"
            ? req.body
            : "";

      const timestamp = req.headers["x-slack-request-timestamp"];
      const signature = req.headers["x-slack-signature"];

      if (typeof timestamp !== "string" || typeof signature !== "string") {
        res.status(401).send("Missing Slack signature headers");
        return;
      }

      if (!verifySlackSignature(signingSecret, timestamp, rawBody, signature)) {
        res.status(401).send("Invalid signature");
        return;
      }

      let payload: SlackEventPayload;
      try {
        payload = JSON.parse(rawBody) as SlackEventPayload;
      } catch {
        res.status(400).send("Invalid JSON");
        return;
      }

      if (payload.type === "url_verification" && payload.challenge) {
        res.json({ challenge: payload.challenge });
        return;
      }

      res.status(200).send();

      const eventId = payload.event_id;
      setImmediate(() => {
        handleMessageEvent(payload, eventId).catch((err) => {
          console.error(
            "[slack-events] background handler error:",
            err instanceof Error ? err.message : err
          );
        });
      });
    }
  );

  console.log("[slack-events] registered POST /api/slack/events");
}
