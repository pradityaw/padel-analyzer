/**
 * Startup recovery planner for in-memory analysis job queue loss.
 * Run: npm run test:analysis-job-recovery
 */
import { planJobRecoveryActions } from "../../server/lib/analysisJobProcessor.js";

function assert(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}:`, err);
    process.exitCode = 1;
  }
}

assert("queued jobs are scheduled on startup", () => {
  const actions = planJobRecoveryActions([
    { id: 1, status: "queued", analysisId: null },
    { id: 2, status: "queued", analysisId: null },
  ]);
  if (actions.length !== 2) throw new Error(`expected 2 actions, got ${actions.length}`);
  if (actions.some((action) => action.type !== "schedule")) {
    throw new Error("expected only schedule actions");
  }
});

assert("processing without analysisId is requeued and scheduled", () => {
  const actions = planJobRecoveryActions([
    { id: 3, status: "processing", analysisId: null },
  ]);
  if (actions.length !== 2) throw new Error(`expected 2 actions, got ${actions.length}`);
  if (actions[0]?.type !== "requeue" || actions[1]?.type !== "schedule") {
    throw new Error(`unexpected actions: ${JSON.stringify(actions)}`);
  }
});

assert("processing with analysisId is marked completed", () => {
  const actions = planJobRecoveryActions([
    { id: 4, status: "processing", analysisId: 99 },
  ]);
  if (actions.length !== 1 || actions[0]?.type !== "markCompleted") {
    throw new Error(`unexpected actions: ${JSON.stringify(actions)}`);
  }
});

assert("completed without analysisId is marked failed", () => {
  const actions = planJobRecoveryActions([
    { id: 5, status: "completed", analysisId: null },
  ]);
  if (actions.length !== 1 || actions[0]?.type !== "markFailed") {
    throw new Error(`unexpected actions: ${JSON.stringify(actions)}`);
  }
});

assert("terminal jobs with analysisId are left alone", () => {
  const actions = planJobRecoveryActions([
    { id: 6, status: "completed", analysisId: 12 },
    { id: 7, status: "failed", analysisId: null },
  ]);
  if (actions.length !== 0) {
    throw new Error(`expected no actions, got ${JSON.stringify(actions)}`);
  }
});
