#!/usr/bin/env node
import assert from "node:assert/strict";
import { parseJsonlLines } from "./jsonl.mjs";
import { normalizeSlackChannelId, slackErrorHint } from "./slack.mjs";

const cases = [
  ["C1234567890", "C1234567890"],
  ["  G1234567890  ", "G1234567890"],
  ['"C1234567890"', "C1234567890"],
  ["'G1234567890'", "G1234567890"],
  ["`C1234567890`", "C1234567890"],
  ["https://workspace.slack.com/archives/C1234567890/p1710000000000000", "C1234567890"],
  ["<#G1234567890|padel-testers>", "G1234567890"],
];

for (const [input, expected] of cases) {
  assert.equal(normalizeSlackChannelId(input), expected);
}

assert.throws(
  () => normalizeSlackChannelId("#padel-testers"),
  /channel name/
);
assert.throws(
  () => normalizeSlackChannelId("https://workspace.slack.com/client/T123/no-channel"),
  /Slack URL/
);
assert.throws(
  () => normalizeSlackChannelId("padel-testers"),
  /raw Slack conversation ID/
);

const warnings = [];
const parsed = parseJsonlLines(
  '{"slack_ts":"1.000001","text":"one"}\nnot-json\n\n{"slack_ts":"2.000002","text":"two"}\n',
  {
    label: "slack-inbox.jsonl",
    log: (msg) => warnings.push(msg),
  }
);
assert.deepEqual(
  parsed.records.map((r) => r.slack_ts),
  ["1.000001", "2.000002"]
);
assert.equal(parsed.skipped, 1);
assert.equal(warnings.length, 1);
assert.match(warnings[0], /Skipping corrupt JSONL line 2/);

assert.match(
  slackErrorHint("conversations.info", "invalid_arguments"),
  /raw Slack conversation ID/
);
assert.match(slackErrorHint("conversations.history", "not_in_channel"), /Invite/);

console.log("[feedback:test-slack-utils] OK");
