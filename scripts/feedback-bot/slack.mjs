const CONVERSATION_ID_RE = /^[CGDM][A-Z0-9]{8,}$/;
const URL_CONVERSATION_ID_RE = /\/archives\/([CGDM][A-Z0-9]{8,})(?:[/?#]|$)/;
const MENTION_CONVERSATION_ID_RE = /^<#([CGDM][A-Z0-9]{8,})(?:\|[^>]*)?>$/;

export class SlackApiError extends Error {
  constructor(method, error, response) {
    super(`Slack ${method} failed: ${error || JSON.stringify(response)}`);
    this.name = "SlackApiError";
    this.method = method;
    this.error = error;
    this.response = response;
  }
}

export async function slackApi(token, method, body = {}, opts = {}) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (opts.throwOnError !== false && !json.ok) {
    throw new SlackApiError(method, json.error, json);
  }
  return json;
}

export function slackErrorHint(method, error) {
  if (error === "invalid_arguments" || error === "channel_not_found") {
    return [
      `${method} rejected SLACK_FEEDBACK_CHANNEL_ID.`,
      "Use a raw Slack conversation ID such as C123... for public channels or G123... for private channels.",
      "Do not use a channel name, #prefix, or an unrelated Slack URL.",
    ].join(" ");
  }
  if (error === "not_in_channel") {
    return "Invite the Slack bot user to the feedback channel with /invite @YourBotName.";
  }
  if (error === "missing_scope") {
    return "Add the required Slack bot scopes and reinstall the Slack app, then update SLACK_BOT_TOKEN if Slack rotates it.";
  }
  if (error === "invalid_auth" || error === "not_authed") {
    return "Check SLACK_BOT_TOKEN; auth.test should succeed with the bot token used by this workflow.";
  }
  return "Check Slack app permissions, bot channel membership, and the channel ID secret.";
}

export function normalizeSlackChannelId(raw) {
  let value = String(raw ?? "").trim();
  if (!value) {
    throw new Error("SLACK_FEEDBACK_CHANNEL_ID is empty.");
  }

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith("`") && value.endsWith("`"))
  ) {
    value = value.slice(1, -1).trim();
  }

  const mentionMatch = value.match(MENTION_CONVERSATION_ID_RE);
  if (mentionMatch) return mentionMatch[1];

  const urlMatch = value.match(URL_CONVERSATION_ID_RE);
  if (urlMatch) return urlMatch[1];

  if (CONVERSATION_ID_RE.test(value)) return value;

  if (value.startsWith("#")) {
    throw new Error(
      "SLACK_FEEDBACK_CHANNEL_ID is a channel name. Use the raw channel ID from Slack channel details instead."
    );
  }

  if (/^https?:\/\//i.test(value)) {
    throw new Error(
      "SLACK_FEEDBACK_CHANNEL_ID is a Slack URL without an /archives/C... or /archives/G... channel ID."
    );
  }

  throw new Error(
    "SLACK_FEEDBACK_CHANNEL_ID must be a raw Slack conversation ID such as C123... or G123...."
  );
}

function channelNameFromInput(raw) {
  let value = String(raw ?? "").trim();
  if (!value) return null;
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }
  if (!value.startsWith("#")) return null;
  const name = value.slice(1).trim();
  return /^[a-z0-9][a-z0-9_-]*$/i.test(name) ? name.toLowerCase() : null;
}

export async function resolveSlackChannelId(token, raw, opts = {}) {
  try {
    return normalizeSlackChannelId(raw);
  } catch (err) {
    const name = channelNameFromInput(raw);
    if (!name) throw err;
    if (!token) throw err;

    const log = opts.log || (() => {});
    log(
      `[slack] Resolving #${name} via conversations.list; prefer storing the raw channel ID in SLACK_FEEDBACK_CHANNEL_ID.`
    );

    let cursor;
    do {
      const body = {
        types: "public_channel,private_channel",
        exclude_archived: true,
        limit: 200,
      };
      if (cursor) body.cursor = cursor;
      const page = await slackApi(token, "conversations.list", body);
      const channel = (page.channels || []).find((c) => c?.name === name);
      if (channel?.id) return channel.id;
      cursor = page.response_metadata?.next_cursor;
    } while (cursor);

    throw new Error(
      `Could not resolve #${name}. Store the raw Slack channel ID in SLACK_FEEDBACK_CHANNEL_ID and invite the bot to that channel.`
    );
  }
}
