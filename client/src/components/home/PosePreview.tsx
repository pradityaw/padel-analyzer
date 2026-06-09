import { useEffect, useRef } from "react";
import type { Landmark } from "@shared/types";
import { drawSkeleton } from "@/lib/skeleton";
import ScoreCard from "@/components/ScoreCard";

const WIDTH = 600;
const HEIGHT = 400;

// Hand-tuned normalized landmarks aligned to the player in
// /preview/padel-pose.jpg (forehand-ready, facing frame-left).
// Indices follow the MediaPipe Pose convention used by drawSkeleton.
function buildPose(): Landmark[] {
  const pts: Record<number, [number, number]> = {
    0: [0.498, 0.16], // nose
    11: [0.572, 0.27], // left shoulder (racket side / upper)
    12: [0.47, 0.305], // right shoulder
    13: [0.638, 0.235], // left elbow
    15: [0.628, 0.195], // left wrist (racket hand / grip)
    14: [0.6, 0.37], // right elbow
    16: [0.715, 0.39], // right wrist (extended hand)
    23: [0.552, 0.58], // left hip
    24: [0.475, 0.6], // right hip
    25: [0.586, 0.73], // left knee
    26: [0.458, 0.75], // right knee
    27: [0.622, 0.88], // left ankle
    28: [0.42, 0.9], // right ankle
  };
  const landmarks: Landmark[] = Array.from({ length: 33 }, () => ({
    x: 0,
    y: 0,
    z: 0,
    visibility: 0,
  }));
  for (const [idx, [x, y]] of Object.entries(pts)) {
    landmarks[Number(idx)] = { x, y, z: 0, visibility: 1 };
  }
  return landmarks;
}

const POSE = buildPose();

export default function PosePreview() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawSkeleton(ctx, POSE, WIDTH, HEIGHT, { highlightContact: true });
  }, []);

  return (
    <div
      className="relative w-full max-w-[600px] rounded-2xl overflow-hidden border border-rule shadow-2xl shadow-accent/5"
      aria-hidden
    >
      <img
        src="/preview/padel-pose.jpg"
        alt=""
        className="block w-full h-auto select-none"
        draggable={false}
      />
      {/* Dark scrim for contrast / dark analysis look */}
      <div className="absolute inset-0 bg-gradient-to-t from-raised/70 via-raised/10 to-raised/30 pointer-events-none" />
      {/* Static skeleton overlay */}
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        className="absolute inset-0 w-full h-full pointer-events-none"
      />
      {/* Score ring, pinned top-right like the analysis HUD */}
      <div className="absolute top-3 right-3 flex flex-col items-center gap-1">
        <div className="rounded-2xl border border-white/10 bg-raised/55 px-3 py-2 backdrop-blur-md">
          <ScoreCard score={62} size="sm" />
        </div>
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-2">
          Score
        </span>
      </div>
      {/* Corner labels */}
      <div className="absolute bottom-3 left-3 right-3 flex justify-between text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-2 pointer-events-none">
        <span>AI pose overlay</span>
        <span className="text-accent">Live preview</span>
      </div>
    </div>
  );
}
