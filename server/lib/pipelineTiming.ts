/** Lightweight stage timing logs for upload/analysis jobs. */

import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { getAnalysisTimingDir } from "./paths.js";

export type PipelineTimingEvent = {
  step: string;
  elapsedMs: number;
  at: string;
  extra?: Record<string, unknown>;
};

export type PipelineTimingSnapshot = {
  label: string;
  startedAt: string;
  elapsedMs: number;
  events: PipelineTimingEvent[];
  finished?: PipelineTimingEvent;
};

export type PipelineTimer = {
  label: string;
  startedAt: number;
  mark: (step: string, extra?: Record<string, unknown>) => void;
  finish: (extra?: Record<string, unknown>) => void;
  snapshot: () => PipelineTimingSnapshot;
};

export function createPipelineTimer(label: string): PipelineTimer {
  const startedAt = Date.now();
  const startedAtIso = new Date(startedAt).toISOString();
  const events: PipelineTimingEvent[] = [];
  let finished: PipelineTimingEvent | undefined;
  console.log(`[pipeline] ${label} start`);

  return {
    label,
    startedAt,
    mark(step, extra) {
      const elapsedMs = Date.now() - startedAt;
      const suffix = extra ? ` ${JSON.stringify(extra)}` : "";
      events.push({
        step,
        elapsedMs,
        at: new Date().toISOString(),
        ...(extra ? { extra } : {}),
      });
      console.log(`[pipeline] ${label} +${elapsedMs}ms ${step}${suffix}`);
    },
    finish(extra) {
      const elapsedMs = Date.now() - startedAt;
      const suffix = extra ? ` ${JSON.stringify(extra)}` : "";
      finished = {
        step: "finish",
        elapsedMs,
        at: new Date().toISOString(),
        ...(extra ? { extra } : {}),
      };
      console.log(`[pipeline] ${label} done ${elapsedMs}ms${suffix}`);
    },
    snapshot() {
      return {
        label,
        startedAt: startedAtIso,
        elapsedMs: Date.now() - startedAt,
        events: [...events],
        ...(finished ? { finished } : {}),
      };
    },
  };
}

export async function writePipelineTimingArtifact(
  jobId: number,
  snapshot: PipelineTimingSnapshot
): Promise<void> {
  const dir = getAnalysisTimingDir();
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, `job-${jobId}-timing.json`),
    JSON.stringify(snapshot, null, 2),
    "utf8"
  );
}
