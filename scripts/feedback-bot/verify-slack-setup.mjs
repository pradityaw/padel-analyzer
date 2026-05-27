#!/usr/bin/env node
/**
 * Preflight for Slack feedback triage (CI or local).
 * Exits 0 when Slack + Cursor env look usable; non-zero otherwise.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFeedbackEnv, repoRoot } from "./env.mjs";
import {
  resolveSlackChannelId,
  slackApi,
  slackErrorHint,
} from "./slack.mjs";

const COLLECT_PATH = resolve(repoRoot, "scripts/feedback-bot/collect-slack.mjs");

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
  let channelId;
  try {
    channelId = await resolveSlackChannelId(token, process.env.SLACK_FEEDBACK_CHANNEL_ID, {
      log: (msg) => console.warn(`[verify-slack] ${msg}`),
    });
  } catch (err) {
    console.error(
      `[verify-slack] Invalid SLACK_FEEDBACK_CHANNEL_ID: ${
        err instanceof Error ? err.message : err
      }`
    );
    process.exit(1);
  }

  const auth = await slackApi(token, "auth.test", {}, { throwOnError: false });
  if (!auth.ok) {
    console.error(`[verify-slack] auth.test failed: ${auth.error}`);
    console.error(`[verify-slack] ${slackErrorHint("auth.test", auth.error)}`);
    process.exit(1);
  }
  console.log(`[verify-slack] Slack bot: ${auth.user} @ ${auth.team}`);
  console.log(`[verify-slack] Channel ID shape: ${channelId[0]}... (${channelId.length} chars)`);

  const info = await slackApi(token, "conversations.info", {
    channel: channelId,
  }, { throwOnError: false });
  if (!info.ok) {
    console.error(`[verify-slack] conversations.info failed: ${info.error}`);
    console.error(`[verify-slack] ${slackErrorHint("conversations.info", info.error)}`);
    process.exit(1);
  }
  console.log(`[verify-slack] Channel: #${info.channel?.name || channelId}`);

  const history = await slackApi(token, "conversations.history", {
    channel: channelId,
    limit: 1,
  }, { throwOnError: false });
  if (!history.ok) {
    console.error(`[verify-slack] conversations.history failed: ${history.error}`);
    console.error(`[verify-slack] ${slackErrorHint("conversations.history", history.error)}`);
    process.exit(1);
  }
  console.log("[verify-slack] conversations.history OK");

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
