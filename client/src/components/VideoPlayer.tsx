import { useRef, useState, useEffect, useCallback } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Eye,
  EyeOff,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { drawSkeleton } from "@/lib/skeleton";
import type { FrameLandmarks, SwingPhase, SwingPhaseType } from "@shared/types";
import { PHASE_LABELS, PHASE_COLORS } from "@shared/types";

type Props = {
  videoUrl: string;
  frames: FrameLandmarks[];
  phases: SwingPhase[];
  sampleFps: number;
  onFrameChange?: (frameIndex: number) => void;
};

export default function VideoPlayer({
  videoUrl,
  frames,
  phases,
  sampleFps,
  onFrameChange,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [playing, setPlaying] = useState(false);
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [dimensions, setDimensions] = useState({ w: 640, h: 480 });
  const [activePhaseType, setActivePhaseType] = useState<SwingPhaseType | undefined>();
  const [contactFlash, setContactFlash] = useState(false);
  const prevPhaseRef = useRef<SwingPhaseType | undefined>();

  const findFrame = useCallback(
    (time: number) => {
      const frameIdx = Math.round(time * sampleFps);
      let closest = 0;
      let minDist = Infinity;
      for (let i = 0; i < frames.length; i++) {
        const dist = Math.abs(frames[i].frameIndex - frameIdx);
        if (dist < minDist) {
          minDist = dist;
          closest = i;
        }
      }
      return closest;
    },
    [frames, sampleFps]
  );

  const renderOverlay = useCallback(
    (idx: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      if (!showSkeleton || !frames[idx]) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }

      const currentPhase = phases.find(
        (p) =>
          frames[idx].frameIndex >= p.startFrame &&
          frames[idx].frameIndex <= p.endFrame
      );

      drawSkeleton(ctx, frames[idx].landmarks, canvas.width, canvas.height, {
        highlightContact: currentPhase?.type === "contact",
      });
    },
    [frames, phases, showSkeleton]
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTimeUpdate = () => {
      const idx = findFrame(video.currentTime);
      setCurrentFrame(idx);
      onFrameChange?.(idx);
      renderOverlay(idx);

      const frame = frames[idx];
      if (frame) {
        const phase = phases.find(
          (p) => frame.frameIndex >= p.startFrame && frame.frameIndex <= p.endFrame
        );
        const newPhaseType = phase?.type;
        setActivePhaseType(newPhaseType);

        // Contact flash
        if (newPhaseType === "contact" && prevPhaseRef.current !== "contact") {
          setContactFlash(true);
          setTimeout(() => setContactFlash(false), 300);
        }
        prevPhaseRef.current = newPhaseType;
      }
    };

    const onMeta = () => {
      setDimensions({ w: video.videoWidth, h: video.videoHeight });
    };

    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("loadedmetadata", onMeta);
    return () => {
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("loadedmetadata", onMeta);
    };
  }, [findFrame, frames, phases, onFrameChange, renderOverlay]);

  useEffect(() => {
    renderOverlay(currentFrame);
  }, [showSkeleton, currentFrame, renderOverlay]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play();
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
    }
  };

  const stepFrame = (dir: -1 | 1) => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    setPlaying(false);
    v.currentTime = Math.max(
      0,
      Math.min(v.duration, v.currentTime + dir / sampleFps)
    );
  };

  const speeds = [0.1, 0.25, 0.5, 1, 2];
  const changeSpeed = () => {
    const next = speeds[(speeds.indexOf(playbackRate) + 1) % speeds.length];
    setPlaybackRate(next);
    if (videoRef.current) videoRef.current.playbackRate = next;
  };

  if (!videoUrl) {
    return (
      <div className="relative bg-slate-900 rounded-xl overflow-hidden border border-padel-border p-8 text-center text-slate-400 text-sm">
        No saved video for replay. Analysis data is still available on the right.
      </div>
    );
  }

  const phaseColor = activePhaseType ? PHASE_COLORS[activePhaseType] : undefined;

  return (
    <div className="relative bg-black rounded-xl overflow-hidden">
      <div className="relative" style={{ aspectRatio: `${dimensions.w}/${dimensions.h}` }}>
        <video
          ref={videoRef}
          src={videoUrl}
          className="w-full h-full object-contain"
          playsInline
          muted
          onEnded={() => setPlaying(false)}
        />
        <canvas
          ref={canvasRef}
          width={dimensions.w}
          height={dimensions.h}
          className="absolute inset-0 w-full h-full pointer-events-none"
        />

        {/* Contact flash vignette */}
        <AnimatePresence>
          {contactFlash && (
            <motion.div
              key="flash"
              initial={{ opacity: 0.6 }}
              animate={{ opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="absolute inset-0 pointer-events-none"
              style={{
                background: "radial-gradient(ellipse at center, rgba(255,255,255,0.18) 0%, transparent 70%)",
              }}
            />
          )}
        </AnimatePresence>

        {/* Phase HUD chip */}
        <AnimatePresence mode="wait">
          {activePhaseType && (
            <motion.div
              key={activePhaseType}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
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
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Phase color progress strip */}
      {activePhaseType && phases.length > 0 && (
        <div className="h-1 w-full bg-slate-800">
          {phases.map((phase) => {
            const left = (phase.startFrame / (phases[phases.length - 1].endFrame || 1)) * 100;
            const width = ((phase.endFrame - phase.startFrame) / (phases[phases.length - 1].endFrame || 1)) * 100;
            return (
              <div
                key={phase.type}
                className="absolute h-1 transition-opacity"
                style={{
                  left: `${left}%`,
                  width: `${width}%`,
                  backgroundColor: PHASE_COLORS[phase.type],
                  opacity: phase.type === activePhaseType ? 1 : 0.3,
                }}
              />
            );
          })}
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-2 p-3 bg-slate-900/90 backdrop-blur">
        <button
          onClick={() => stepFrame(-1)}
          className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
        >
          <SkipBack className="w-4 h-4" />
        </button>
        <button
          onClick={togglePlay}
          className="p-2 rounded-lg bg-padel-green text-black hover:opacity-90 transition-colors"
        >
          {playing ? (
            <Pause className="w-4 h-4" />
          ) : (
            <Play className="w-4 h-4" />
          )}
        </button>
        <button
          onClick={() => stepFrame(1)}
          className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
        >
          <SkipForward className="w-4 h-4" />
        </button>

        <button
          onClick={changeSpeed}
          className="ml-2 px-2 py-1 rounded text-xs font-mono bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors min-w-[38px] text-center"
        >
          {playbackRate}x
        </button>

        <div className="flex-1" />

        <span className="text-xs text-slate-500 font-mono">
          Frame {frames[currentFrame]?.frameIndex ?? 0}
        </span>

        <button
          onClick={() => setShowSkeleton(!showSkeleton)}
          className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
        >
          {showSkeleton ? (
            <Eye className="w-4 h-4" />
          ) : (
            <EyeOff className="w-4 h-4" />
          )}
        </button>
      </div>
    </div>
  );
}
