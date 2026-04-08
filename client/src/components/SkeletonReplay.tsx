import { useRef, useEffect, useState, useCallback } from "react";
import { Play, Pause, SkipBack, SkipForward } from "lucide-react";
import type { FrameLandmarks } from "@shared/types";
import { drawSkeleton } from "@/lib/skeleton";

type Props = {
  frames: FrameLandmarks[];
  width?: number;
  height?: number;
  autoPlay?: boolean;
  /** Controlled mode: parent manages frame index */
  controlledFrameIdx?: number;
  /** Callback when frame changes (for parent sync) */
  onFrameChange?: (idx: number) => void;
  /** Hide built-in controls (parent provides shared controls) */
  showControls?: boolean;
  /** Border accent color */
  accentColor?: string;
  /** Label shown above the canvas */
  label?: string;
};

export default function SkeletonReplay({
  frames,
  width = 300,
  height = 400,
  autoPlay = true,
  controlledFrameIdx,
  onFrameChange,
  showControls = true,
  accentColor,
  label,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [internalIdx, setInternalIdx] = useState(0);
  const [playing, setPlaying] = useState(autoPlay);
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);

  const isControlled = controlledFrameIdx !== undefined;
  const frameIdx = isControlled ? controlledFrameIdx : internalIdx;
  const setFrameIdx = isControlled
    ? (val: number | ((prev: number) => number)) => {
        const next = typeof val === "function" ? val(frameIdx) : val;
        onFrameChange?.(next);
      }
    : setInternalIdx;

  const totalFrames = frames.length;
  const fps = 15;
  const frameInterval = 1000 / fps;

  const drawFrame = useCallback(
    (idx: number) => {
      const canvas = canvasRef.current;
      if (!canvas || !frames[idx]) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.fillStyle = "#0f172a";
      ctx.fillRect(0, 0, width, height);

      drawSkeleton(ctx, frames[idx].landmarks, width, height);
    },
    [frames, width, height]
  );

  // Animation loop (only in uncontrolled mode)
  useEffect(() => {
    if (isControlled || !playing || totalFrames === 0) return;

    let currentFrame = frameIdx;

    const animate = (timestamp: number) => {
      if (timestamp - lastTimeRef.current >= frameInterval) {
        lastTimeRef.current = timestamp;
        currentFrame = (currentFrame + 1) % totalFrames;
        setInternalIdx(currentFrame);
        onFrameChange?.(currentFrame);
        drawFrame(currentFrame);
      }
      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isControlled, playing, totalFrames, frameInterval, drawFrame]);

  // Draw on frame change
  useEffect(() => {
    drawFrame(frameIdx);
  }, [frameIdx, drawFrame]);

  const borderStyle = accentColor
    ? { borderColor: accentColor }
    : undefined;

  return (
    <div className="flex flex-col items-center gap-2">
      {label && (
        <span
          className="text-xs font-semibold uppercase tracking-wider"
          style={accentColor ? { color: accentColor } : undefined}
        >
          {label}
        </span>
      )}
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="rounded-lg border border-padel-border"
        style={borderStyle}
      />

      {showControls && (
        <div className="flex items-center gap-2 w-full max-w-[300px]">
          <button
            onClick={() => {
              setPlaying(false);
              setFrameIdx((prev: number) => Math.max(0, prev - 1));
            }}
            className="p-1.5 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
          >
            <SkipBack className="w-4 h-4" />
          </button>

          <button
            onClick={() => setPlaying((p) => !p)}
            className="p-1.5 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
          >
            {playing ? (
              <Pause className="w-4 h-4" />
            ) : (
              <Play className="w-4 h-4" />
            )}
          </button>

          <button
            onClick={() => {
              setPlaying(false);
              setFrameIdx((prev: number) => Math.min(totalFrames - 1, prev + 1));
            }}
            className="p-1.5 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
          >
            <SkipForward className="w-4 h-4" />
          </button>

          <input
            type="range"
            min={0}
            max={totalFrames - 1}
            value={frameIdx}
            onChange={(e) => {
              setPlaying(false);
              setFrameIdx(Number(e.target.value));
            }}
            className="flex-1 accent-padel-green"
          />

          <span className="text-xs text-slate-500 tabular-nums w-14 text-right">
            {frameIdx + 1}/{totalFrames}
          </span>
        </div>
      )}
    </div>
  );
}
