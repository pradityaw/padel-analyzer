import { writeFile } from "fs/promises";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { courtCornersInputSchema } from "../../shared/schema.js";

export type CourtCornersOverrideFile = {
  normalized: true;
  corners: Array<{ x: number; y: number }>;
};

export function parseCourtCornersJson(
  courtCornersJson: string | null | undefined
): CourtCornersOverrideFile | null {
  if (!courtCornersJson?.trim()) return null;
  try {
    const parsed = JSON.parse(courtCornersJson) as unknown;
    const validated = courtCornersInputSchema.parse(parsed);
    return {
      normalized: true,
      corners: validated.corners.map((c) => ({ x: c.x, y: c.y })),
    };
  } catch {
    return null;
  }
}

/** Write a temp JSON file for `run_agent_stage.py --court-corners`. Caller must delete the dir. */
export async function writeCourtCornersOverrideFile(
  courtCornersJson: string | null | undefined
): Promise<{ dir: string; filePath: string } | null> {
  const payload = parseCourtCornersJson(courtCornersJson);
  if (!payload) return null;
  const dir = await mkdtemp(path.join(tmpdir(), "padel-court-corners-"));
  const filePath = path.join(dir, "court_corners.json");
  await writeFile(filePath, JSON.stringify(payload), "utf8");
  return { dir, filePath };
}

export async function removeCourtCornersOverrideDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}
