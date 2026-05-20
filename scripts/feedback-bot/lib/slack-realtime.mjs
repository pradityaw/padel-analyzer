/**
 * Real-time Slack feedback: ingest one message → Cursor agent → thread reply.
 */
import { loadFeedbackEnv } from "../env.mjs";
import { shouldSkipSlackRecord } from "../filter.mjs";
import {
  addReactionEyes,
  isAllowlistedUser,
  sendSlackThreadReply,
} from "./slack-api.mjs";
import {
  appendInboxRecord,
  clearMessageInFlight,
  isEventProcessed,
  isMessageInFlight,
  isMessageProcessed,
  markEventProcessed,
  markMessageInFlight,
  markMessagesProcessed,
} from "./slack-state.mjs";
import {
  buildBundleFromMessages,
  formatThreadCompletionReport,
  runAgentOnBundle,
} from "./slack-agent.mjs";

/**
 * @param {object} record — inbox row from collect or Events API
 * @param {{ eventId?: string; channelId?: string; threadTs?: string }} meta
 */
export async function processRealtimeSlackFeedback(record, meta = {}) {
  loadFeedbackEnv();

  const token = process.env.SLACK_BOT_TOKEN;
  const channelId = meta.channelId || process.env.SLACK_FEEDBACK_CHANNEL_ID;
  const threadTs = meta.threadTs || record.slack_ts;
  const eventId = meta.eventId;

  if (!token || !channelId) {
    throw new Error("Set SLACK_BOT_TOKEN and SLACK_FEEDBACK_CHANNEL_ID");
  }

  if (eventId && isEventProcessed(eventId)) {
    console.log(`[slack-realtime] skip duplicate event_id=${eventId}`);
    return { skipped: true, reason: "duplicate_event" };
  }

  const slackTs = String(record.slack_ts);
  if (isMessageProcessed(slackTs)) {
    console.log(`[slack-realtime] skip already processed ts=${slackTs}`);
    if (eventId) markEventProcessed(eventId);
    return { skipped: true, reason: "already_processed" };
  }

  if (isMessageInFlight(slackTs)) {
    console.log(`[slack-realtime] skip in-flight ts=${slackTs}`);
    if (eventId) markEventProcessed(eventId);
    return { skipped: true, reason: "in_flight" };
  }

  if (shouldSkipSlackRecord(record)) {
    console.log(`[slack-realtime] skip noise ts=${slackTs}`);
    markMessagesProcessed([slackTs]);
    if (eventId) markEventProcessed(eventId);
    return { skipped: true, reason: "noise" };
  }

  if (!isAllowlistedUser(record.from?.id)) {
    console.log(`[slack-realtime] skip non-allowlisted user`);
    if (eventId) markEventProcessed(eventId);
    return { skipped: true, reason: "not_allowlisted" };
  }

  if (eventId) markEventProcessed(eventId);
  markMessageInFlight(slackTs);

  try {
    appendInboxRecord(record);
    await addReactionEyes(token, channelId, slackTs);
    await sendSlackThreadReply(
      token,
      channelId,
      threadTs,
      ":eyes: *Started working on your feedback* - running a Cursor cloud agent now. I'll reply here when the job finishes (usually a few minutes)."
    );

    const bundle = buildBundleFromMessages(
      [record],
      `event-${slackTs.replace(".", "_")}`
    );
    const outcome = await runAgentOnBundle(bundle, { logToStdout: false });
    await sendSlackThreadReply(
      token,
      channelId,
      threadTs,
      formatThreadCompletionReport(outcome)
    );

    markMessagesProcessed([slackTs]);
    return { skipped: false, outcome };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try {
      await sendSlackThreadReply(
        token,
        channelId,
        threadTs,
        `:x: *Feedback job failed*\n${msg}\nRetry with \`npm run feedback:triage-slack\` or post again.`
      );
    } catch {
      /* ignore secondary Slack errors */
    }
    clearMessageInFlight(slackTs);
    throw err;
  }
}
