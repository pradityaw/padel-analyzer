/**
 * Slack feedback state + inbox persistence.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { repoRoot } from "../env.mjs";

export const FEEDBACK_DIR = resolve(repoRoot, "qa-artifacts/feedback");
export const STATE_PATH = resolve(FEEDBACK_DIR, "slack-state.json");
export const INBOX_PATH = resolve(FEEDBACK_DIR, "slack-inbox.jsonl");
export const RUN_LOG_DIR = resolve(repoRoot, ".cursor-sdk-runs/feedback");

export function compareTs(a, b) {
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

function maxTsStrings(ids) {
  return ids.reduce((a, b) => (compareTs(a, b) >= 0 ? a : b), ids[0]);
}

export function readState() {
  if (!existsSync(STATE_PATH)) {
    return {
      oldest_ts: "0",
      consumed_ts: "0",
      processed_message_ids: [],
      processed_event_ids: [],
      in_flight_message_ts: [],
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
      processed_event_ids: Array.isArray(j.processed_event_ids)
        ? j.processed_event_ids.map(String)
        : [],
      in_flight_message_ts: Array.isArray(j.in_flight_message_ts)
        ? j.in_flight_message_ts.map(String)
        : [],
    };
  } catch {
    return {
      oldest_ts: "0",
      consumed_ts: "0",
      processed_message_ids: [],
      processed_event_ids: [],
      in_flight_message_ts: [],
    };
  }
}

export function writeState(next) {
  mkdirSync(FEEDBACK_DIR, { recursive: true });
  writeFileSync(STATE_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

export function isMessageProcessed(slackTs) {
  const state = readState();
  return state.processed_message_ids.includes(String(slackTs));
}

export function isEventProcessed(eventId) {
  const state = readState();
  return state.processed_event_ids.includes(String(eventId));
}

export function isMessageInFlight(slackTs) {
  const state = readState();
  return state.in_flight_message_ts.includes(String(slackTs));
}

export function markMessageInFlight(slackTs) {
  const current = readState();
  const merged = new Set([...current.in_flight_message_ts, String(slackTs)]);
  writeState({
    ...current,
    in_flight_message_ts: [...merged].sort((a, b) => compareTs(a, b)),
  });
}

export function clearMessageInFlight(slackTs) {
  const current = readState();
  writeState({
    ...current,
    in_flight_message_ts: current.in_flight_message_ts.filter(
      (id) => id !== String(slackTs)
    ),
  });
}

export function markEventProcessed(eventId) {
  const current = readState();
  const merged = new Set([...current.processed_event_ids, String(eventId)]);
  writeState({
    ...current,
    processed_event_ids: [...merged].slice(-500),
  });
}

export function markMessagesProcessed(slackTsList) {
  const ids = slackTsList.map(String);
  const current = readState();
  const merged = new Set([...current.processed_message_ids, ...ids]);
  const sorted = [...merged].sort((a, b) => compareTs(a, b));
  writeState({
    ...current,
    processed_message_ids: sorted,
    consumed_ts: maxTsStrings([current.consumed_ts, ...ids]),
    in_flight_message_ts: current.in_flight_message_ts.filter(
      (id) => !ids.includes(id)
    ),
  });
}

export function appendInboxRecord(record) {
  mkdirSync(FEEDBACK_DIR, { recursive: true });
  appendFileSync(INBOX_PATH, `${JSON.stringify(record)}\n`, "utf8");
}
