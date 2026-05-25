#!/usr/bin/env node
/**
 * Preflight for Slack feedback triage (CI or local).
 * Exits 0 when Slack + Cursor env look usable; non-zero otherwise.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFeedbackEnv, repoRoot } from "./env.mjs";

const COLLECT_PATH = resolve(repoRoot, "scripts/feedback-bot/collect-slack.mjs");

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
  return json;
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) {
    console.error(`[verify-slack] Missing ${name}`);
    return false;
  }
  return true;
}

function checkCollectHardening() {
  const src = readFileSync(COLLECT_PATH, "utf8");
  if (!src.includes("fetchThreadReplies") || !src.includes("threadParentTs")) {
    console.error(
      "[verify-slack] collect-slack.mjs missing thread reply hardening (fetchThreadReplies)"
    );
    return false;
  }
  return true;
}

async function main() {
  loadFeedbackEnv();

  let ok = true;
  ok = requireEnv("SLACK_BOT_TOKEN") && ok;
  ok = requireEnv("SLACK_FEEDBACK_CHANNEL_ID") && ok;
  ok = requireEnv("CURSOR_API_KEY") && ok;
  ok = checkCollectHardening() && ok;

  if (!ok) process.exit(1);

  const token = process.env.SLACK_BOT_TOKEN;
  const channelId = process.env.SLACK_FEEDBACK_CHANNEL_ID;

  const auth = await slackApi(token, "auth.test");
  if (!auth.ok) {
    console.error(`[verify-slack] auth.test failed: ${auth.error}`);
    process.exit(1);
  }
  console.log(`[verify-slack] Slack bot: ${auth.user} @ ${auth.team}`);

  const trimmedChannelId = String(channelId).trim();
  let channelName = trimmedChannelId;

  const info = await slackApi(token, "conversations.info", {
    channel: trimmedChannelId,
  });
  if (info.ok) {
    channelName = info.channel?.name || channelName;
  } else {
    const history = await slackApi(token, "conversations.history", {
      channel: trimmedChannelId,
      limit: 1,
    });
    if (!history.ok) {
      console.error(
        `[verify-slack] Channel access failed: conversations.info=${info.error}, conversations.history=${history.error}`
      );
      console.error(
        "[verify-slack] Is the bot invited to the channel? Channel ID correct?"
      );
      process.exit(1);
    }

    const list = await slackApi(token, "conversations.list", {
      types: "public_channel,private_channel",
      limit: 200,
      exclude_archived: true,
    });
    const match = (list.channels || []).find((ch) => ch.id === trimmedChannelId);
    if (match?.name) channelName = match.name;
    console.warn(
      `[verify-slack] conversations.info unavailable (${info.error}); verified via conversations.history`
    );
  }
  console.log(`[verify-slack] Channel: #${channelName}`);

  const allowlist = process.env.SLACK_ALLOWLIST_USER_IDS;
  if (allowlist?.trim()) {
    const ids = allowlist.split(",").map((s) => s.trim()).filter(Boolean);
    console.log(`[verify-slack] Allowlist: ${ids.length} user id(s)`);
  } else {
    console.warn(
      "[verify-slack] SLACK_ALLOWLIST_USER_IDS unset — all channel members can trigger PRs"
    );
  }

  if (process.env.FEEDBACK_REPO_URL) {
    console.log(`[verify-slack] FEEDBACK_REPO_URL=${process.env.FEEDBACK_REPO_URL}`);
  } else {
    console.log(
      "[verify-slack] FEEDBACK_REPO_URL unset — cloud agent uses default padel-analyzer repo"
    );
  }

  console.log("[verify-slack] OK — ready for collect + Cursor SDK triage");
}

const isMain =
  !!process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
