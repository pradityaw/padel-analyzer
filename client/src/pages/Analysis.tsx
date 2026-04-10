import { useState, useCallback, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import { motion } from "framer-motion";
import { ArrowLeft, ChevronDown, Trophy } from "lucide-react";
import { trpc } from "@/lib/trpc";
import VideoPlayer from "@/components/VideoPlayer";
import PhaseTimeline from "@/components/PhaseTimeline";
import MetricsPanel from "@/components/MetricsPanel";
import ScoreCard from "@/components/ScoreCard";
import SwingCoachingPanel from "@/components/SwingCoachingPanel";
import type { FrameLandmarks, SwingPhase, SwingPhaseType, ShotType } from "@shared/types";
import { SHOT_TYPES, SHOT_TYPE_LABELS, SHOT_TYPE_COLORS } from "@shared/types";

function ShotTypeBadge({
  shotType,
  confidence,
  analysisId,
}: {
  shotType: string | null;
  confidence: number | null;
  analysisId: number;
}) {
  const [open, setOpen] = useState(false);
  const utils = trpc.useUtils();
  const createAnnotation = trpc.annotation.create.useMutation({
    onSuccess: () => {
      utils.analysis.getById.invalidate({ id: analysisId });
      utils.annotation.stats.invalidate();
      setOpen(false);
    },
  });

  const color = shotType
    ? SHOT_TYPE_COLORS[shotType as ShotType] ?? "#64748b"
    : "#64748b";
  const label = shotType
    ? SHOT_TYPE_LABELS[shotType as ShotType] ?? shotType
    : "Unclassified";

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-padel-border hover:border-slate-500 transition-colors text-sm"
      >
        <span
          className="w-2.5 h-2.5 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span>{label}</span>
        {confidence != null && (
          <span className="text-slate-500 text-xs">
            {Math.round(confidence * 100)}%
          </span>
        )}
        <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
      </button>

      {open && (
        <div className="absolute top-full mt-1 right-0 z-20 bg-padel-surface border border-padel-border rounded-lg shadow-xl p-1 min-w-[140px]">
          {SHOT_TYPES.map((type) => (
            <button
              key={type}
              onClick={() => {
                createAnnotation.mutate({
                  analysisId,
                  shotType: type,
                  isProReference: false,
                });
              }}
              className={`w-full flex items-center gap-2 px-3 py-1.5 rounded text-sm text-left hover:bg-white/5 transition-colors ${
                type === shotType ? "text-padel-green" : "text-slate-300"
              }`}
            >
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: SHOT_TYPE_COLORS[type] }}
              />
              {SHOT_TYPE_LABELS[type]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Analysis() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const [currentFrameIdx, setCurrentFrameIdx] = useState(0);

  const { data, isLoading, error } = trpc.analysis.getById.useQuery(
    { id: Number(id) },
    { enabled: !!id }
  );

  // Lazy-load landmarks separately — only fetched when this page mounts
  const { data: landmarksRaw } = trpc.analysis.getLandmarks.useQuery(
    { id: Number(id) },
    { enabled: !!data }
  );

  const parsedData = useMemo(() => {
    if (!data || !landmarksRaw) return null;
    return {
      phases: JSON.parse(data.phasesJson) as SwingPhase[],
      frames: JSON.parse(landmarksRaw) as FrameLandmarks[],
    };
  }, [data, landmarksRaw]);

  const activePhase = useMemo<SwingPhaseType | undefined>(() => {
    if (!parsedData) return undefined;
    const frame = parsedData.frames[currentFrameIdx];
    if (!frame) return undefined;
    const phase = parsedData.phases.find(
      (p) => frame.frameIndex >= p.startFrame && frame.frameIndex <= p.endFrame
    );
    return phase?.type;
  }, [parsedData, currentFrameIdx]);

  const handleSeek = useCallback(
    (frame: number) => {
      if (!parsedData) return;
      const idx = parsedData.frames.findIndex((f) => f.frameIndex >= frame);
      if (idx >= 0) setCurrentFrameIdx(idx);
    },
    [parsedData]
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="w-8 h-8 border-2 border-padel-green border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data || !parsedData) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12 text-center">
        <p className="text-red-400 mb-4">Analysis not found.</p>
        <button
          onClick={() => navigate("/")}
          className="text-padel-green hover:underline"
        >
          Back to sessions
        </button>
      </div>
    );
  }

  const videoUrl = useMemo(() => {
    const key =
      data.videoStorageKey ??
      (data.videoFileName.startsWith("yt_") ? data.videoFileName : null);
    return key ? `/uploads/${key}` : "";
  }, [data]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="max-w-7xl mx-auto px-4 py-6"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/")}
            className="p-2 rounded-lg hover:bg-white/5 text-slate-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl font-bold">{data.videoFileName}</h1>
            <p className="text-xs text-slate-500">
              {new Date(data.createdAt).toLocaleDateString()} —{" "}
              {data.dominantSide === "right" ? "Right" : "Left"}-handed
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 hidden sm:inline">
            {data.frameCount} frames · {(data.durationMs / 1000).toFixed(1)}s
          </span>
        </div>
      </div>

      {/* Main layout */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Video panel */}
        <div className="lg:col-span-3">
          <VideoPlayer
            videoUrl={videoUrl}
            frames={parsedData.frames}
            phases={parsedData.phases}
            sampleFps={data.sampleFps}
            onFrameChange={setCurrentFrameIdx}
          />
          <PhaseTimeline
            phases={parsedData.phases}
            totalFrames={data.frameCount}
            currentFrame={
              parsedData.frames[currentFrameIdx]?.frameIndex ?? 0
            }
            onSeek={handleSeek}
          />
        </div>

        {/* Sidebar: score + coaching + metrics */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          {/* Overall score + shot type badge row */}
          <div className="flex items-center justify-between bg-padel-surface rounded-xl border border-padel-border px-5 py-4">
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-widest mb-1">Overall Score</p>
              <ScoreCard score={data.overallScore} size="lg" />
            </div>
            <div className="flex flex-col items-end gap-2">
              <ShotTypeBadge
                shotType={data.shotType ?? null}
                confidence={data.shotConfidence ?? null}
                analysisId={data.id}
              />
              <button
                onClick={() => navigate(`/pro-compare?player=${data.id}`)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-400/30 text-amber-400 hover:bg-amber-400/10 transition-colors text-xs"
              >
                <Trophy className="w-3.5 h-3.5" />
                Compare with Pro
              </button>
            </div>
          </div>

          {/* Coaching tips */}
          <SwingCoachingPanel phases={parsedData.phases} />

          {/* Per-phase metrics */}
          <MetricsPanel
            phases={parsedData.phases}
            activePhase={activePhase}
          />
        </div>
      </div>
    </motion.div>
  );
}
