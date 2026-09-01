import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc.js";
import { db } from "../db.js";
import {
  proComparisons,
  proBenchmarks,
  analyses,
  annotations,
} from "../../drizzle/schema.js";
import { eq, desc, and, sql } from "drizzle-orm";
import { ownerIdForInsert, requireOwnedAnalysis, requireOwner, requireAccessibleAnalysis, isProReferenceAnalysis } from "../lib/ownership.js";

export const proCompareRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        playerAnalysisId: z.number(),
        proAnalysisId: z.number().optional(),
        shotType: z.string(),
        gapAnalysisJson: z.string(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireOwnedAnalysis(ctx.authMode, ctx.user?.id, input.playerAnalysisId);
      if (input.proAnalysisId != null) {
        requireAccessibleAnalysis(ctx.authMode, ctx.user?.id, input.proAnalysisId);
      }
      const userId = ownerIdForInsert(ctx.authMode, ctx.user?.id);
      return db
        .insert(proComparisons)
        .values({
          userId,
          playerAnalysisId: input.playerAnalysisId,
          proAnalysisId: input.proAnalysisId ?? null,
          shotType: input.shotType,
          gapAnalysisJson: input.gapAnalysisJson,
          notes: input.notes ?? null,
        })
        .returning()
        .get();
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    const ownerFilter =
      ctx.authMode === "on" && ctx.user
        ? eq(proComparisons.userId, ctx.user.id)
        : undefined;
    const base = db
      .select({
        comparison: proComparisons,
        playerFileName: analyses.videoFileName,
        playerScore: analyses.overallScore,
      })
      .from(proComparisons)
      .innerJoin(analyses, eq(proComparisons.playerAnalysisId, analyses.id));
    const rows = (ownerFilter ? base.where(ownerFilter) : base)
      .orderBy(desc(proComparisons.createdAt))
      .all();

    // Enrich with pro filename where available
    return rows.map((r) => {
      let proFileName: string | null = null;
      let proScore: number | null = null;
      if (r.comparison.proAnalysisId) {
        const pro = db
          .select({
            id: analyses.id,
            userId: analyses.userId,
            videoFileName: analyses.videoFileName,
            overallScore: analyses.overallScore,
          })
          .from(analyses)
          .where(eq(analyses.id, r.comparison.proAnalysisId))
          .get();
        const allowed =
          !!pro &&
          (ctx.authMode === "off" ||
            (ctx.user != null && pro.userId === ctx.user.id) ||
            isProReferenceAnalysis(pro.id));
        if (pro && allowed) {
          proFileName = pro.videoFileName;
          proScore = pro.overallScore;
        }
      }
      return {
        ...r.comparison,
        playerFileName: r.playerFileName,
        playerScore: r.playerScore,
        proFileName,
        proScore,
      };
    });
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const row =
        db
          .select()
          .from(proComparisons)
          .where(eq(proComparisons.id, input.id))
          .get() ?? null;
      if (!row) return null;
      requireOwner(ctx.authMode, ctx.user?.id, row.userId);
      return row;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const row = db
        .select()
        .from(proComparisons)
        .where(eq(proComparisons.id, input.id))
        .get();
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Comparison not found." });
      }
      requireOwner(ctx.authMode, ctx.user?.id, row.userId);
      db.delete(proComparisons)
        .where(eq(proComparisons.id, input.id))
        .run();
      return { success: true };
    }),

  listProAnalyses: protectedProcedure.query(async () => {
    const rows = db
      .select({
        analysisId: annotations.analysisId,
        shotType: annotations.shotType,
        videoFileName: analyses.videoFileName,
        overallScore: analyses.overallScore,
        dominantSide: analyses.dominantSide,
        frameCount: analyses.frameCount,
        durationMs: analyses.durationMs,
        phasesJson: analyses.phasesJson,
      })
      .from(annotations)
      .innerJoin(analyses, eq(annotations.analysisId, analyses.id))
      .where(eq(annotations.isProReference, true))
      .all();

    return rows;
  }),

  // Get aggregated pro benchmark for a shot type
  getProBenchmark: protectedProcedure
    .input(z.object({ shotType: z.string() }))
    .query(async ({ input }) => {
      // Count current pro annotations for this shot type
      const countResult = db
        .select({ count: sql<number>`count(*)` })
        .from(annotations)
        .where(
          and(
            eq(annotations.isProReference, true),
            eq(annotations.shotType, input.shotType)
          )
        )
        .get();
      const currentCount = countResult?.count ?? 0;

      if (currentCount === 0) {
        return null;
      }

      // Check cache
      const cached = db
        .select()
        .from(proBenchmarks)
        .where(
          and(
            eq(proBenchmarks.shotType, input.shotType),
            eq(proBenchmarks.referenceTier, "pro")
          )
        )
        .get();

      if (cached && cached.sampleCount === currentCount) {
        return {
          shotType: cached.shotType,
          sampleCount: cached.sampleCount,
          phases: JSON.parse(cached.metricsJson),
        };
      }

      // Recompute: get all pro analyses for this shot type
      const proRows = db
        .select({ phasesJson: analyses.phasesJson })
        .from(annotations)
        .innerJoin(analyses, eq(annotations.analysisId, analyses.id))
        .where(
          and(
            eq(annotations.isProReference, true),
            eq(annotations.shotType, input.shotType)
          )
        )
        .all();

      // Average metrics per phase
      const phaseTypes = [
        "ready",
        "backswing",
        "forwardSwing",
        "contact",
        "followThrough",
      ];
      const metricKeys = [
        "shoulderRotation",
        "hipRotation",
        "elbowAngle",
        "kneeFlex",
        "spineAngle",
        "wristVelocity",
      ];

      const avgPhases: Record<string, Record<string, number>> = {};

      for (const pt of phaseTypes) {
        avgPhases[pt] = {};
        for (const mk of metricKeys) {
          const values: number[] = [];
          for (const row of proRows) {
            const phases = JSON.parse(row.phasesJson);
            const phase = phases.find((p: any) => p.type === pt);
            if (phase?.metrics?.[mk] != null) {
              values.push(phase.metrics[mk]);
            }
          }
          avgPhases[pt][mk] =
            values.length > 0
              ? values.reduce((a, b) => a + b, 0) / values.length
              : 0;
        }
      }

      const metricsJson = JSON.stringify(avgPhases);

      // Upsert cache
      if (cached) {
        db.update(proBenchmarks)
          .set({
            sampleCount: currentCount,
            metricsJson,
            updatedAt: new Date().toISOString(),
          })
          .where(
            and(
              eq(proBenchmarks.shotType, input.shotType),
              eq(proBenchmarks.referenceTier, "pro")
            )
          )
          .run();
      } else {
        db.insert(proBenchmarks)
          .values({
            shotType: input.shotType,
            referenceTier: "pro",
            sampleCount: currentCount,
            metricsJson,
          })
          .run();
      }

      return {
        shotType: input.shotType,
        sampleCount: currentCount,
        phases: avgPhases,
      };
    }),

  // Export all paired comparison data for training
  exportPairedData: protectedProcedure.query(async ({ ctx }) => {
    const ownerFilter =
      ctx.authMode === "on" && ctx.user
        ? eq(proComparisons.userId, ctx.user.id)
        : undefined;
    const q = db.select().from(proComparisons);
    const rows = (ownerFilter ? q.where(ownerFilter) : q)
      .orderBy(desc(proComparisons.createdAt))
      .all();

    const pairs = [];
    for (const comp of rows) {
      const player = db
        .select()
        .from(analyses)
        .where(eq(analyses.id, comp.playerAnalysisId))
        .get();
      if (!player) continue;

      let pro = null;
      if (comp.proAnalysisId) {
        const candidate = db
          .select()
          .from(analyses)
          .where(eq(analyses.id, comp.proAnalysisId))
          .get();
        const allowed =
          !!candidate &&
          (ctx.authMode === "off" ||
            (ctx.user != null && candidate.userId === ctx.user.id) ||
            isProReferenceAnalysis(candidate.id));
        if (candidate && allowed) {
          pro = candidate;
        }
      }

      pairs.push({
        id: comp.id,
        shotType: comp.shotType,
        player: {
          analysisId: player.id,
          dominantSide: player.dominantSide,
          frameCount: player.frameCount,
          landmarks: JSON.parse(player.landmarksJson),
          phases: JSON.parse(player.phasesJson),
        },
        pro: pro
          ? {
              analysisId: pro.id,
              dominantSide: pro.dominantSide,
              frameCount: pro.frameCount,
              landmarks: JSON.parse(pro.landmarksJson),
              phases: JSON.parse(pro.phasesJson),
            }
          : null,
        gapAnalysis: JSON.parse(comp.gapAnalysisJson),
      });
    }

    // Get benchmarks
    const benchmarks: Record<string, any> = {};
    const benchmarkRows = db
      .select()
      .from(proBenchmarks)
      .where(eq(proBenchmarks.referenceTier, "pro"))
      .all();
    for (const b of benchmarkRows) {
      benchmarks[b.shotType] = {
        sampleCount: b.sampleCount,
        phases: JSON.parse(b.metricsJson),
      };
    }

    return {
      version: "2.0",
      exportedAt: new Date().toISOString(),
      sampleFps: 15,
      pairs,
      benchmarks,
    };
  }),
});
