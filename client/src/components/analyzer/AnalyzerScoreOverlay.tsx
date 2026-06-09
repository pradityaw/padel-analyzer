import { cn } from "@/lib/utils";
import type { ShotType, SwingPhaseType } from "@shared/types";
import {
  PHASE_COLORS,
  PHASE_LABELS,
  SHOT_TYPE_COLORS,
  SHOT_TYPE_LABELS,
} from "@shared/types";

export type AnalyzerScoreOverlayProps = {
  overallScore: number;
  activePhase?: SwingPhaseType;
  currentFrameIndex: number;
  totalFrames: number;
  currentTimeSec?: number;
  durationSec?: number;
  playerScore?: string;
  opponentScore?: string;
  rallyActive?: boolean;
  /** e.g. "P1, P2" when a subset of tracked players is selected */
  playerFilterLabel?: string | null;
  /** Session shot type is hidden because stroke filters exclude it */
  strokeFilterActive?: boolean;
  strokeFilterMatch?: boolean;
  activeShotType?: string | null;
};

function formatTimeSec(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const total = Math.floor(sec);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function scoreAccentColor(score: number): string {
  if (score >= 80) return "#5b8cff";
  if (score >= 60) return "#e8c468";
  return "#ef4444";
}

export default function AnalyzerScoreOverlay({
  overallScore,
  activePhase,
  currentFrameIndex,
  totalFrames,
  currentTimeSec,
  durationSec,
  playerScore,
  opponentScore,
  rallyActive = false,
  playerFilterLabel,
  strokeFilterActive = false,
  strokeFilterMatch = true,
  activeShotType,
}: AnalyzerScoreOverlayProps) {
  const phaseLabel = activePhase ? PHASE_LABELS[activePhase] : undefined;
  const phaseColor = activePhase ? PHASE_COLORS[activePhase] : undefined;
  const accentColor = scoreAccentColor(overallScore);
  const showTime =
    currentTimeSec !== undefined &&
    Number.isFinite(currentTimeSec) &&
    durationSec !== undefined &&
    Number.isFinite(durationSec) &&
    durationSec > 0;

  const playerDisplay = playerScore?.trim() || "—";
  const opponentDisplay = opponentScore?.trim() || "—";
  const matchScoreUnavailable = playerDisplay === "—" && opponentDisplay === "—";
  const frameDisplay = Math.max(0, currentFrameIndex);
  const frameTotal = Math.max(totalFrames, 1);
  const shotLabel = activeShotType
    ? SHOT_TYPE_LABELS[activeShotType as ShotType] ?? activeShotType
    : null;
  const shotColor = activeShotType
    ? SHOT_TYPE_COLORS[activeShotType as ShotType] ?? "#5b8cff"
    : undefined;
  const strokeHidden = strokeFilterActive && !strokeFilterMatch;

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 z-10 transition-opacity duration-200",
        strokeHidden && "opacity-55"
      )}
    >
      {strokeHidden ? (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 rounded-full border border-sand/40 bg-raised/70 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-sand backdrop-blur-md">
          Hidden by stroke filter
        </div>
      ) : null}

      {activeShotType && shotLabel && shotColor && strokeFilterMatch ? (
        <div
          className="absolute top-14 left-3 flex items-center gap-1.5 rounded-full border border-white/10 px-2.5 py-1 text-xs font-semibold backdrop-blur-md"
          style={{
            backgroundColor: `${shotColor}22`,
            borderColor: `${shotColor}55`,
            color: shotColor,
          }}
        >
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: shotColor }}
          />
          {shotLabel}
        </div>
      ) : null}

      {activePhase && phaseLabel && phaseColor ? (
        <div
          className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full border border-white/10 px-2.5 py-1 text-xs font-semibold backdrop-blur-md"
          style={{
            backgroundColor: `${phaseColor}22`,
            borderColor: `${phaseColor}55`,
            color: phaseColor,
          }}
        >
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: phaseColor }}
          />
          {phaseLabel}
        </div>
      ) : null}

      <div className="absolute top-3 right-3">
        <div className="rounded-2xl border border-white/10 bg-raised/55 px-3 py-2 shadow-2xl backdrop-blur-md">
          <div className="flex items-center gap-2.5">
            {rallyActive ? (
              <span
                className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent"
                aria-hidden
              />
            ) : null}
            <div className="flex items-end gap-2.5 tabular-nums">
              <div className="flex flex-col items-center">
                <span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-2">
                  You
                </span>
                <span className="text-lg font-bold leading-none text-ink">
                  {playerDisplay}
                </span>
              </div>
              <span className="pb-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-2">
                vs
              </span>
              <div className="flex flex-col items-center">
                <span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-2">
                  Opp
                </span>
                <span className="text-lg font-bold leading-none text-ink-2">
                  {opponentDisplay}
                </span>
              </div>
            </div>
          </div>
          {rallyActive ? (
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-accent/90">
              Rally
            </p>
          ) : matchScoreUnavailable ? (
            <p className="mt-1 text-[9px] font-medium text-muted-2">
              Match score not tracked
            </p>
          ) : null}
          {playerFilterLabel ? (
            <p className="mt-0.5 text-[10px] font-medium text-ink-2">
              Tracking {playerFilterLabel}
            </p>
          ) : null}
        </div>
      </div>

      <div className="absolute bottom-3 left-3 rounded-xl border border-white/10 bg-raised/45 px-2.5 py-1.5 backdrop-blur-md">
        <p className="text-xs font-medium tabular-nums text-ink-2">
          Frame {frameDisplay + 1}
          <span className="text-muted-2"> / {frameTotal}</span>
        </p>
        {showTime ? (
          <p className="mt-0.5 text-[10px] tabular-nums text-ink-2">
            {formatTimeSec(currentTimeSec)} / {formatTimeSec(durationSec!)}
          </p>
        ) : null}
      </div>

      <div className="absolute bottom-3 right-3">
        <div
          className="flex items-center gap-2 rounded-2xl border border-white/10 bg-raised/55 px-3 py-2 shadow-2xl backdrop-blur-md"
          style={{ borderColor: `${accentColor}33` }}
        >
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-2">
            Score
          </span>
          <span
            className="text-2xl font-bold tabular-nums leading-none"
            style={{ color: accentColor }}
          >
            {Math.round(overallScore)}
          </span>
        </div>
      </div>
    </div>
  );
}
