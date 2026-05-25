import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, SkipBack, SkipForward, Eye, EyeOff } from "lucide-react";
import { drawSkeleton } from "@/lib/skeleton";
import { buildFrameSyncIndex, getPhaseAtFrameIndex } from "@/lib/frameSync";
import type { FrameLandmarks, SwingPhase, SwingPhaseType } from "@shared/types";
import { PHASE_COLORS, PHASE_LABELS } from "@shared/types";

type Props = {
  frames: FrameLandmarks[];
  phases: SwingPhase[];
  sampleFps: number;
  onFrameChange?: (index: number) => void;
};

export default function FrameSkeletonPlayer({
  frames,
  phases,
  sampleFps,
  onFrameChange,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [playing, setPlaying] = useState(true);
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [activePhaseType, setActivePhaseType] = useState<SwingPhaseType>();

  const frameSync = useMemo(
    () => buildFrameSyncIndex(frames, sampleFps),
    [frames, sampleFps]
  );
  const lastPaintedRef = useRef(-1);

  const renderOverlay = useCallback(
    (idx: number) => {
      if (idx === lastPaintedRef.current) return;
      lastPaintedRef.current = idx;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (!showSkeleton || !frames[idx]) return;

      const phase = getPhaseAtFrameIndex(
        phases,
        frames[idx]!.frameIndex
      );
      setActivePhaseType(phase?.type);
      drawSkeleton(ctx, frames[idx]!.landmarks, canvas.width, canvas.height, {
        highlightContact: phase?.type === "contact",
      });
    },
    [frames, phases, showSkeleton]
  );

  useEffect(() => {
    lastPaintedRef.current = -1;
    renderOverlay(currentFrame);
    onFrameChange?.(currentFrame);
  }, [currentFrame, renderOverlay, onFrameChange]);

  useEffect(() => {
    if (!playing || frames.length === 0) return;
    const ms = 1000 / frameSync.sampleFps;
    const id = window.setInterval(() => {
      setCurrentFrame((f) => (f + 1) % frames.length);
    }, ms);
    return () => clearInterval(id);
  }, [playing, frames.length, frameSync.sampleFps]);

  const phaseColor = activePhaseType ? PHASE_COLORS[activePhaseType] : undefined;

  return (
    <div className="relative bg-black rounded-xl overflow-hidden border border-padel-border">
      <div className="relative aspect-[4/5] max-h-[480px]">
        <canvas ref={canvasRef} width={640} height={800} className="w-full h-full" />
        {activePhaseType ? (
          <div
            className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold backdrop-blur-sm"
            style={{
              backgroundColor: `${phaseColor}22`,
              border: `1px solid ${phaseColor}55`,
              color: phaseColor,
            }}
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: phaseColor }}
            />
            {PHASE_LABELS[activePhaseType]}
          </div>
        ) : null}
      </div>
      <div className="flex items-center gap-2 p-3 bg-slate-900/90">
        <button
          type="button"
          aria-label={playing ? "Pause" : "Play"}
          onClick={() => setPlaying((p) => !p)}
          className="p-2 rounded-lg bg-padel-green text-black"
        >
          {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </button>
        <button
          type="button"
          onClick={() => {
            setPlaying(false);
            setCurrentFrame((f) => Math.max(0, f - 1));
          }}
          className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400"
        >
          <SkipBack className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => {
            setPlaying(false);
            setCurrentFrame((f) => Math.min(frames.length - 1, f + 1));
          }}
          className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400"
        >
          <SkipForward className="w-4 h-4" />
        </button>
        <span className="text-xs text-slate-500 font-mono ml-auto">
          Frame {frames[currentFrame]?.frameIndex ?? 0}
        </span>
        <button
          type="button"
          onClick={() => setShowSkeleton(!showSkeleton)}
          className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400"
        >
          {showSkeleton ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
