import { useEffect, useRef } from "react";
import { useInView, useReducedMotion } from "framer-motion";
import { drawSkeleton } from "@/lib/skeleton";
import { generateDemoSwingFrames } from "@/lib/demoLandmarks";

const WIDTH = 400;
const HEIGHT = 500;
const FRAMES = generateDemoSwingFrames(48);

export default function AnimatedSkeletonDemo() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef(0);
  const rafRef = useRef<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const isInView = useInView(containerRef, { margin: "-80px" });
  const prefersReduced = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const drawCourt = () => {
      const g = ctx.createLinearGradient(0, 0, 0, HEIGHT);
      g.addColorStop(0, "#0f172a");
      g.addColorStop(0.5, "#14532d");
      g.addColorStop(1, "#0f172a");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      ctx.strokeStyle = "rgba(163, 230, 53, 0.15)";
      ctx.lineWidth = 2;
      ctx.strokeRect(24, 24, WIDTH - 48, HEIGHT - 48);
    };

    const drawFrame = (idx: number) => {
      drawCourt();
      const frame = FRAMES[idx % FRAMES.length];
      if (frame) {
        drawSkeleton(ctx, frame.landmarks, WIDTH, HEIGHT, {
          highlightContact: idx >= 33 && idx <= 36,
        });
      }
    };

    if (prefersReduced) {
      drawFrame(28);
      return;
    }

    if (!isInView) {
      drawFrame(frameRef.current);
      return;
    }

    let last = performance.now();
    const tick = (now: number) => {
      if (now - last > 66) {
        frameRef.current = (frameRef.current + 1) % FRAMES.length;
        drawFrame(frameRef.current);
        last = now;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isInView, prefersReduced]);

  return (
    <div
      ref={containerRef}
      className="relative rounded-2xl overflow-hidden border border-padel-border shadow-2xl shadow-padel-green/5"
      aria-hidden
    >
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        className="w-full max-w-[400px] h-auto block mx-auto"
      />
      <div className="absolute bottom-3 left-3 right-3 flex justify-between text-[10px] uppercase tracking-wider text-slate-400/90 pointer-events-none">
        <span>AI pose overlay</span>
        <span className="text-padel-green">Live preview</span>
      </div>
    </div>
  );
}
