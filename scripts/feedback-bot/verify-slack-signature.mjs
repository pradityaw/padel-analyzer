#!/usr/bin/env node
/**
 * Self-test Slack request signature verification (no network).
 * Usage: SLACK_SIGNING_SECRET=abc node scripts/feedback-bot/verify-slack-signature.mjs
 */
import crypto from "node:crypto";

const secret = process.env.SLACK_SIGNING_SECRET || "test_secret";
const timestamp = String(Math.floor(Date.now() / 1000));
const body = JSON.stringify({ type: "url_verification", challenge: "test_challenge" });
const base = `v0:${timestamp}:${body}`;
const signature =
  "v0=" + crypto.createHmac("sha256", secret).update(base).digest("hex");

function verify(signingSecret, ts, rawBody, sig) {
  const sigBase = `v0:${ts}:${rawBody}`;
  const expected =
    "v0=" +
    crypto.createHmac("sha256", signingSecret).update(sigBase).digest("hex");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "utf8"),
      Buffer.from(sig, "utf8")
    );
  } catch {
    return false;
  }
}

const ok = verify(secret, timestamp, body, signature);
const badSig =
  "v0=" + "0".repeat(crypto.createHmac("sha256", secret).digest("hex").length);
const bad = verify(secret, timestamp, body, badSig);
console.log(`signature ok=${ok} bad_reject=${!bad}`);
process.exitCode = ok && !bad ? 0 : 1;
