/**
 * Regression: Slack Events route must be registered before express.json()
 * so signature verification receives the raw body.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerSlackFeedbackRoutes } from "../../server/lib/slackFeedbackEvents.js";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);

function signSlackRequest(secret: string, body: string) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const base = `v0:${timestamp}:${body}`;
  const signature =
    "v0=" + crypto.createHmac("sha256", secret).update(base).digest("hex");
  return { timestamp, signature };
}

function assertServerEntryWiresSlackRoute(): void {
  const indexSrc = readFileSync(
    path.join(rootDir, "server/_core/index.ts"),
    "utf8"
  );
  const jsonIdx = indexSrc.indexOf("app.use(express.json(");
  const registerIdx = indexSrc.indexOf("registerSlackFeedbackRoutes(app)");
  assert.notEqual(
    registerIdx,
    -1,
    "server/_core/index.ts must call registerSlackFeedbackRoutes"
  );
  assert.ok(
    registerIdx < jsonIdx,
    "registerSlackFeedbackRoutes must run before express.json() for raw Slack bodies"
  );
}

async function assertSignedUrlVerification(): Promise<void> {
  const secret = "test_signing_secret_for_qa";
  process.env.SLACK_SIGNING_SECRET = secret;
  delete process.env.SLACK_FEEDBACK_CHANNEL_ID;
  delete process.env.SLACK_BOT_TOKEN;

  const app = express();
  registerSlackFeedbackRoutes(app);
  app.use(express.json({ limit: "1mb" }));

  const server = await new Promise<import("node:http").Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });

  const address = server.address();
  assert(address && typeof address === "object");
  const port = address.port;

  try {
    const body = JSON.stringify({
      type: "url_verification",
      challenge: "padel_qa_challenge",
    });
    const { timestamp, signature } = signSlackRequest(secret, body);

    const okRes = await fetch(`http://127.0.0.1:${port}/api/slack/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Slack-Request-Timestamp": timestamp,
        "X-Slack-Signature": signature,
      },
      body,
    });
    assert.equal(okRes.status, 200);
    const okJson = (await okRes.json()) as { challenge?: string };
    assert.equal(okJson.challenge, "padel_qa_challenge");

    const badSig =
      "v0=" + "0".repeat(crypto.createHmac("sha256", secret).digest("hex").length);
    const badRes = await fetch(`http://127.0.0.1:${port}/api/slack/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Slack-Request-Timestamp": timestamp,
        "X-Slack-Signature": badSig,
      },
      body,
    });
    assert.equal(badRes.status, 401);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

assertServerEntryWiresSlackRoute();
await assertSignedUrlVerification();
console.log("[slack-events-route] OK");
