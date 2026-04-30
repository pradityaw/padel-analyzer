/**
 * Bootstrap skill training: assign synthetic quality bands to a stratified subset of
 * annotations so exportSkillTrainingData contains multiple QUALITY_BANDS.
 *
 * Run from repo root: npx tsx scripts/seed-skill-quality-bands.ts
 *
 * Replace with real curated amateur labels (Annotate / bulk_process) for production.
 */

import { eq } from "drizzle-orm";
import { annotations } from "../drizzle/schema.js";
import { db } from "../server/db.js";

type Band = "pro" | "beginner" | "developing" | "solid_amateur";

function bandForAnnotationId(id: number): Band {
  const r = id % 5;
  if (r === 0 || r === 1) return "pro";
  if (r === 2) return "beginner";
  if (r === 3) return "developing";
  return "solid_amateur";
}

function main() {
  const rows = db
    .select({ id: annotations.id })
    .from(annotations)
    .orderBy(annotations.id)
    .all();

  const counts: Record<string, number> = {
    pro: 0,
    beginner: 0,
    developing: 0,
    solid_amateur: 0,
  };

  db.transaction((tx) => {
    for (const row of rows) {
      const band = bandForAnnotationId(row.id);
      counts[band]++;

      if (band === "pro") {
        tx.update(annotations)
          .set({
            referenceTier: "pro",
            qualityBand: "pro",
            isProReference: true,
          })
          .where(eq(annotations.id, row.id))
          .run();
      } else {
        tx.update(annotations)
          .set({
            referenceTier: "amateur_curated",
            qualityBand: band,
            isProReference: false,
            sourceType: "bulk_import",
            notes: "seed: synthetic band for skill training bootstrap",
          })
          .where(eq(annotations.id, row.id))
          .run();
      }
    }
  });

  console.log(`Updated ${rows.length} annotations. Distribution:`);
  for (const [k, v] of Object.entries(counts)) {
    console.log(`  ${k}: ${v}`);
  }
}

main();
