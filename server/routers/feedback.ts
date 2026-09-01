import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc.js";
import { db } from "../db.js";
import { feedback } from "../../drizzle/schema.js";
import { ownerIdForInsert } from "../lib/ownership.js";
import { logger } from "../lib/logger.js";

const feedbackTagSchema = z.enum([
  "looked_wrong",
  "slow",
  "crash",
  "confusing",
  "other",
]);

async function notifySlack(payload: {
  rating: number;
  comment: string | null;
  tag: string | null;
  analysisId: number | null;
  email: string | null;
}): Promise<void> {
  const webhook = process.env.SLACK_FEEDBACK_WEBHOOK_URL;
  if (!webhook) {
    logger.info(payload, "in-app feedback");
    return;
  }
  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: [
          `Beta feedback (${payload.rating}/5)`,
          payload.tag ? `tag: ${payload.tag}` : null,
          payload.analysisId ? `analysis: ${payload.analysisId}` : null,
          payload.email ? `from: ${payload.email}` : null,
          payload.comment || "(no comment)",
        ]
          .filter(Boolean)
          .join("\n"),
      }),
    });
  } catch (err) {
    logger.warn({ err }, "Slack feedback webhook failed");
  }
}

export const feedbackRouter = router({
  submit: protectedProcedure
    .input(
      z.object({
        analysisId: z.number().int().positive().optional(),
        rating: z.number().int().min(1).max(5),
        comment: z.string().max(2000).optional(),
        tag: feedbackTagSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ownerIdForInsert(ctx.authMode, ctx.user?.id);
      const row = db
        .insert(feedback)
        .values({
          userId,
          analysisId: input.analysisId ?? null,
          rating: input.rating,
          comment: input.comment ?? null,
          tag: input.tag ?? null,
        })
        .returning()
        .get();
      await notifySlack({
        rating: input.rating,
        comment: input.comment ?? null,
        tag: input.tag ?? null,
        analysisId: input.analysisId ?? null,
        email: ctx.user?.email ?? null,
      });
      return { ok: true as const, id: row.id };
    }),
});
