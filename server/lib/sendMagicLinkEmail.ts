import { logger } from "./logger.js";

export type MagicLinkEmailResult = { sent: boolean; provider: string };

function provider(): string {
  return (process.env.EMAIL_PROVIDER ?? "console").trim().toLowerCase();
}

async function sendViaResend(to: string, url: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? "Padel Analyzer <noreply@localhost>";
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not set");
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject: "Sign in to Padel Analyzer",
      text: `Open this link to sign in (expires in 15 minutes):\n\n${url}\n`,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend rejected the message (${res.status}): ${body.slice(0, 200)}`);
  }
}

export async function sendMagicLinkEmail(
  email: string,
  url: string,
): Promise<MagicLinkEmailResult> {
  const name = provider();
  if (name === "resend") {
    await sendViaResend(email, url);
    logger.info({ email, provider: name }, "magic link emailed");
    return { sent: true, provider: name };
  }

  if (process.env.NODE_ENV !== "production") {
    logger.warn({ email, url, provider: name }, "magic link (console provider)");
  } else {
    logger.warn(
      { email, provider: name },
      "magic link issued but EMAIL_PROVIDER is not resend — mail was not sent",
    );
  }
  return { sent: false, provider: name };
}
