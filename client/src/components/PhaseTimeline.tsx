import { useRef } from "react";
import type { SwingPhase } from "@shared/types";
import { PHASE_LABELS, PHASE_COLORS } from "@shared/types";

type Props = {
  phases: SwingPhase[];
  totalFrames: number;
  currentFrame: number;
  onSeek: (frame: number) => void;
};

export default function PhaseTimeline({
  phases,
  totalFrames,
  currentFrame,
  onSeek,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);

  if (phases.length === 0 || totalFrames === 0) return null;

  const playheadPos = (currentFrame / totalFrames) * 100;

  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const frame = Math.round(ratio * totalFrames);
    onSeek(Math.max(0, Math.min(totalFrames, frame)));
  };

  return (
    <div className="mt-4">
      {/* Legend row */}
      <div className="flex items-center gap-3 mb-2 flex-wrap">
        {phases.map((phase) => {
          const isActive =
            currentFrame >= phase.startFrame && currentFrame <= phase.endFrame;
          return (
            <button
              key={phase.type}
              onClick={() => onSeek(phase.startFrame)}
              className="flex items-center gap-1.5 text-xs transition-opacity"
              style={{ opacity: isActive ? 1 : 0.5 }}
            >
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: PHASE_COLORS[phase.type] }}
              />
              <span className={isActive ? "text-white" : "text-slate-400"}>
                {PHASE_LABELS[phase.type]}
              </span>
              <span
                className="font-mono text-[10px] px-1 rounded"
                style={{
                  color: PHASE_COLORS[phase.type],
                  backgroundColor: `${PHASE_COLORS[phase.type]}18`,
                }}
              >
                {phase.score}
              </span>
            </button>
          );
        })}
      </div>

      {/* Timeline track — click anywhere to seek */}
      <div
        ref={trackRef}
        className="relative h-9 bg-slate-800/60 rounded-lg overflow-hidden cursor-pointer select-none"
        onClick={handleTrackClick}
      >
        {phases.map((phase) => {
          const left = (phase.startFrame / totalFrames) * 100;
          const width = ((phase.endFrame - phase.startFrame) / totalFrames) * 100;
          const isActive =
            currentFrame >= phase.startFrame && currentFrame <= phase.endFrame;

          return (
            <div
              key={phase.type}
              className="absolute top-0 h-full flex items-center justify-center transition-opacity"
              style={{
                left: `${left}%`,
                width: `${width}%`,
                backgroundColor: PHASE_COLORS[phase.type],
                opacity: isActive ? 0.85 : 0.38,
              }}
            >
              {/* Score badge — only show if segment wide enough */}
              {width > 7 && (
                <span className="text-[10px] font-bold text-white/90 select-none pointer-events-none">
                  {phase.score}
                </span>
              )}
            </div>
          );
        })}

        {/* Playhead */}
        <div
          className="absolute top-0 h-full w-0.5 bg-white z-10 pointer-events-none shadow-[0_0_4px_rgba(255,255,255,0.7)]"
          style={{ left: `${playheadPos}%` }}
        />
      </div>
    </div>
  );
}
