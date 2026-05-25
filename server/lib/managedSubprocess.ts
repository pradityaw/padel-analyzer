import type { ChildProcess } from "child_process";
import { CV_PROCESS_SIGKILL_GRACE_MS } from "../../shared/config.js";

function positiveNumberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Give Python/OpenCV workers a short graceful shutdown window, then force-kill.
 */
export function terminateChildWithEscalation(child: ChildProcess): void {
  child.kill("SIGTERM");
  const killTimer = setTimeout(() => {
    if (child.exitCode == null && child.signalCode == null) {
      child.kill("SIGKILL");
    }
  }, positiveNumberFromEnv("CV_PROCESS_SIGKILL_GRACE_MS", CV_PROCESS_SIGKILL_GRACE_MS));
  killTimer.unref?.();
}
