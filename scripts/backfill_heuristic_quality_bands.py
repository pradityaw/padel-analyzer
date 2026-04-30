#!/usr/bin/env python3
"""Backfill heuristic quality bands for existing curated amateur annotations."""

import argparse
import json
import sqlite3
from collections import Counter
from pathlib import Path

from quality_banding import infer_quality_band


def main():
    parser = argparse.ArgumentParser(description="Backfill heuristic amateur quality bands")
    parser.add_argument(
        "--db",
        default=str(Path(__file__).parent.parent / "data" / "padel.db"),
        help="Path to padel.db",
    )
    args = parser.parse_args()

    conn = sqlite3.connect(args.db)
    cursor = conn.cursor()
    rows = cursor.execute(
        """
        SELECT
            annotations.id,
            annotations.analysis_id,
            annotations.notes,
            analyses.overall_score,
            analyses.phases_json
        FROM annotations
        INNER JOIN analyses ON analyses.id = annotations.analysis_id
        WHERE annotations.reference_tier = 'amateur_curated'
        """
    ).fetchall()

    counts = Counter()
    updated = 0

    for annotation_id, analysis_id, notes, overall_score, phases_json in rows:
        analysis = {
            "overallScore": float(overall_score or 0),
            "phases": json.loads(phases_json or "[]"),
        }
        heuristic = infer_quality_band(analysis)
        updated += 1
        counts[heuristic["qualityBand"]] += 1

        note_parts = [notes or ""]
        if "labelSource:heuristic_backfill" not in (notes or ""):
            note_parts.append("labelSource:heuristic_backfill")
        note_parts.append(heuristic["rationale"])
        final_notes = " | ".join(part for part in note_parts if part).strip()

        cursor.execute(
            """
            UPDATE annotations
            SET quality_band = ?, notes = ?
            WHERE id = ?
            """,
            (heuristic["qualityBand"], final_notes, annotation_id),
        )
        cursor.execute(
            """
            UPDATE analyses
            SET skill_label = ?, skill_confidence = ?, quality_score = ?
            WHERE id = ?
            """,
            (
                heuristic["qualityBand"],
                heuristic["skillConfidence"],
                heuristic["qualityScore"],
                analysis_id,
            ),
        )

    conn.commit()
    conn.close()

    print(f"Updated {updated} amateur_curated annotations.")
    for band, count in sorted(counts.items()):
        print(f"  {band}: {count}")


if __name__ == "__main__":
    main()
