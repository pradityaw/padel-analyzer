/** Single-process job queue. Each job may run multiple analysis agents in parallel. */
import { logger } from "./logger.js";

const MAX_CONCURRENT = 1;

let running = 0;
const pending: number[] = [];

export function enqueueAnalysisJob(
  jobId: number,
  processor: (id: number) => Promise<void>
): void {
  pending.push(jobId);
  void drain(processor);
}

async function drain(processor: (id: number) => Promise<void>): Promise<void> {
  while (running < MAX_CONCURRENT && pending.length > 0) {
    const jobId = pending.shift()!;
    running += 1;
    try {
      await processJob(jobId, processor);
    } finally {
      running -= 1;
    }
  }
  if (pending.length > 0) {
    void drain(processor);
  }
}

async function processJob(
  jobId: number,
  processor: (id: number) => Promise<void>
): Promise<void> {
  try {
    await processor(jobId);
  } catch (error) {
    logger.error({ jobId, err: error }, "analysis job unhandled failure");
  }
}
