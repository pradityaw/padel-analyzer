#!/usr/bin/env node
/**
 * Live tests for deployed /api/slack/events (signed requests).
 * Usage: node scripts/feedback-bot/test-slack-live.mjs [--full]
 *   --full  also simulates an actionable message (starts a Cursor cloud agent)
 */
import crypto from "node:crypto";
import { loadFeedbackEnv } from "./env.mjs";

const BASE = process.env.SLACK_EVENTS_URL || "https://padel-analyzer.fly.dev/api/slack/events";

function sign(secret, body) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const base = `v0:${timestamp}:${body}`;
  const signature =
    "v0=" + crypto.createHmac("sha256", secret).update(base).digest("hex");
  return { timestamp, signature };
}

async function postSlackPayload(bodyObj) {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) throw new Error("SLACK_SIGNING_SECRET missing");
  const body = JSON.stringify(bodyObj);
  const { timestamp, signature } = sign(secret, body);
  const res = await fetch(BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Slack-Request-Timestamp": timestamp,
      "X-Slack-Signature": signature,
    },
    body,
  });
  const text = await res.text();
  return { status: res.status, text };
}

async function postAnchorMessage() {
  const token = process.env.SLACK_BOT_TOKEN;
  const channelId = process.env.SLACK_FEEDBACK_CHANNEL_ID;
  if (!token || !channelId) {
    throw new Error("SLACK_BOT_TOKEN / SLACK_FEEDBACK_CHANNEL_ID missing");
  }
  const json = await (
    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel: channelId,
        text: ":test_tube: *Realtime bot connectivity test* — processing this message now…",
      }),
    })
  ).json();
  if (!json.ok) throw new Error(`chat.postMessage failed: ${json.error}`);
  return String(json.ts);
}

async function main() {
  const full = process.argv.includes("--full");
  loadFeedbackEnv();

  console.log("[test] 1/3 url_verification challenge…");
  const v = await postSlackPayload({
    type: "url_verification",
    challenge: "padel_connectivity_test",
  });
  console.log(`       status=${v.status} body=${v.text.slice(0, 120)}`);
  if (v.status !== 200 || !v.text.includes("padel_connectivity_test")) {
    throw new Error("url_verification failed");
  }

  const channelId = process.env.SLACK_FEEDBACK_CHANNEL_ID;
  const allowUser = process.env.SLACK_ALLOWLIST_USER_IDS?.split(",")[0]?.trim();
  if (!channelId || !allowUser) {
    throw new Error("Need SLACK_FEEDBACK_CHANNEL_ID and SLACK_ALLOWLIST_USER_IDS");
  }

  console.log("[test] 2/3 noise message (should skip agent)…");
  const noiseTs = `${Date.now()}.000001`;
  const noise = await postSlackPayload({
    type: "event_callback",
    event_id: `test-noise-${Date.now()}`,
    event: {
      type: "message",
      channel: channelId,
      user: allowUser,
      text: "hi",
      ts: noiseTs,
    },
  });
  console.log(`       status=${noise.status} (expect 200 empty)`);
  if (noise.status !== 200) throw new Error("noise event failed");

  await new Promise((r) => setTimeout(r, 3000));

  if (!full) {
    console.log("[test] 3/3 skipped (--full not set; no Cursor agent spend)");
    console.log("[test] OK — endpoint verified. Post in Slack for full UX test.");
    return;
  }

  console.log("[test] 3/3 actionable message (starts Cursor cloud agent)…");
  const actionTs = await postAnchorMessage();
  console.log(`       anchor message ts=${actionTs}`);
  const action = await postSlackPayload({
    type: "event_callback",
    event_id: `test-action-${Date.now()}`,
    event: {
      type: "message",
      channel: channelId,
      user: allowUser,
      text: `Problem: Slack real-time connectivity test
Device/browser: Fly.io production / Slack Events API
Steps: Deploy padel-analyzer → enable Event Subscriptions → POST message
What happened: Verifying end-to-end webhook → Cursor agent → thread reply
Expected: Bot adds eyes reaction and replies in thread with job status`,
      ts: actionTs,
    },
  });
  console.log(`       status=${action.status} (expect 200 empty)`);
  if (action.status !== 200) throw new Error("actionable event failed");
  console.log("[test] OK — check Slack channel for :eyes: and thread replies.");
}

main().catch((err) => {
  console.error("[test] FAIL:", err.message);
  process.exit(1);
});
