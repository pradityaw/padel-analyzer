/**
 * Shared Slack Web API helpers for feedback bot (CLI + server Events API).
 */

export async function slackApi(token, method, body = {}) {
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

export async function addReactionEyes(token, channelId, ts) {
  try {
    await slackApi(token, "reactions.add", {
      channel: channelId,
      timestamp: ts,
      name: "eyes",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("already_reacted")) return;
    console.warn(`[slack-api] reactions.add skipped: ${msg}`);
  }
}

export async function sendSlackSummary(token, channelId, lines) {
  const text = lines.join("\n").slice(0, 3000);
  await slackApi(token, "chat.postMessage", {
    channel: channelId,
    text,
  });
}

export async function sendSlackThreadReply(token, channelId, threadTs, text) {
  await slackApi(token, "chat.postMessage", {
    channel: channelId,
    thread_ts: threadTs,
    text: text.slice(0, 3000),
  });
}

export function parseAllowlistUserIds() {
  const raw = process.env.SLACK_ALLOWLIST_USER_IDS;
  if (!raw || !String(raw).trim()) return null;
  return new Set(
    String(raw)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

export function isAllowlistedUser(userId) {
  const allowlist = parseAllowlistUserIds();
  if (!allowlist) return true;
  return allowlist.has(String(userId));
}
