import { z } from "zod";
import { router, publicProcedure } from "../_core/trpc.js";
import { db } from "../db.js";
import {
  proComparisons,
  proBenchmarks,
  analyses,
  annotations,
} from "../../drizzle/schema.js";
import { eq, desc, and, sql } from "drizzle-orm";

export const proCompareRouter = router({
  create: publicProcedure
    .input(
      z.object({
        playerAnalysisId: z.number(),
        proAnalysisId: z.number().optional(),
        shotType: z.string(),
        gapAnalysisJson: z.string(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      return db
        .insert(proComparisons)
        .values({
          playerAnalysisId: input.playerAnalysisId,
          proAnalysisId: input.proAnalysisId ?? null,
          shotType: input.shotType,
          gapAnalysisJson: input.gapAnalysisJson,
          notes: input.notes ?? null,
        })
        .returning()
        .get();
    }),

  list: publicProcedure.query(async () => {
    // Get all comparisons with player/pro filenames
    const rows = db
      .select({
        comparison: proComparisons,
        playerFileName: analyses.videoFileName,
        playerScore: analyses.overallScore,
      })
      .from(proComparisons)
      .innerJoin(analyses, eq(proComparisons.playerAnalysisId, analyses.id))
      .orderBy(desc(proComparisons.createdAt))
      .all();

    // Enrich with pro filename where available
    return rows.map((r) => {
      let proFileName: string | null = null;
      let proScore: number | null = null;
      if (r.comparison.proAnalysisId) {
        const pro = db
          .select({
            videoFileName: analyses.videoFileName,
            overallScore: analyses.overallScore,
          })
          .from(analyses)
          .where(eq(analyses.id, r.comparison.proAnalysisId))
          .get();
        if (pro) {
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

  getById: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return (
        db
          .select()
          .from(proComparisons)
          .where(eq(proComparisons.id, input.id))
          .get() ?? null
      );
    }),

  delete: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      db.delete(proComparisons)
        .where(eq(proComparisons.id, input.id))
        .run();
      return { success: true };
    }),

  // List analyses annotated as pro references, grouped by shot type
  listProAnalyses: publicProcedure.query(async () => {
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
  getProBenchmark: publicProcedure
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
        .where(eq(proBenchmarks.shotType, input.shotType))
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
          .where(eq(proBenchmarks.shotType, input.shotType))
          .run();
      } else {
        db.insert(proBenchmarks)
          .values({
            shotType: input.shotType,
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
  exportPairedData: publicProcedure.query(async () => {
    const rows = db
      .select()
      .from(proComparisons)
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
        pro = db
          .select()
          .from(analyses)
          .where(eq(analyses.id, comp.proAnalysisId))
          .get();
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
    const benchmarkRows = db.select().from(proBenchmarks).all();
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
