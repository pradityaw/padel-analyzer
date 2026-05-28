import { useState, useCallback, useMemo, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { motion } from "framer-motion";
import { ArrowLeft, ChevronDown, Film, Ruler, Scissors, Trophy } from "lucide-react";
import { trpc } from "@/lib/trpc";
import VideoPlayer, { type VideoPlayerHandle } from "@/components/VideoPlayer";
import { buildFrameSyncIndex, getPhaseAtFrameIndex } from "@/lib/frameSync";
import { tryParseJson } from "@/lib/safeJson";
import PhaseTimeline from "@/components/PhaseTimeline";
import MetricsPanel from "@/components/MetricsPanel";
import ScoreCard from "@/components/ScoreCard";
import SwingCoachingPanel from "@/components/SwingCoachingPanel";
import {
  ballTrackingSchema,
  racketTrackingSchema,
} from "@shared/schema";
import type {
  BallTrackSample,
  FrameLandmarks,
  RacketTrackSample,
  SwingPhase,
  SwingPhaseType,
  ShotType,
  RecordMode,
} from "@shared/types";
import {
  RECORD_MODE_LABELS,
  SHOT_TYPES,
  SHOT_TYPE_LABELS,
  SHOT_TYPE_COLORS,
} from "@shared/types";

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
  const [onlyRallies, setOnlyRallies] = useState(false);
  const [courtCalibrationEnabled, setCourtCalibrationEnabled] = useState(false);
  const videoPlayerRef = useRef<VideoPlayerHandle>(null);

  const analysisId = Number(id);
  const { data, isLoading, error } = trpc.analysis.getById.useQuery(
    { id: analysisId },
    { enabled: !!id }
  );

  // Lazy rally detection — first call may spawn the Python detector (audio
  // + motion + velocity fusion); subsequent calls hit the JSON cache.
  const rallyQuery = trpc.analysis.getRallies.useQuery(
    { analysisId },
    {
      enabled: !!id && Number.isFinite(analysisId) && analysisId > 0,
      retry: false,
      staleTime: 5 * 60 * 1000,
    }
  );
  const rallies = rallyQuery.data?.rallies ?? [];
  const rallyDetectionInFlight = rallyQuery.isLoading;
  const rallyDetectionFailed = !!rallyQuery.error;

  const parsedData = useMemo(() => {
    if (!data) return null;
    const phasesR = tryParseJson<SwingPhase[]>(data.phasesJson);
    const framesR = tryParseJson<FrameLandmarks[]>(data.landmarksJson);
    if (!phasesR.ok || !framesR.ok) return null;
    if (!Array.isArray(phasesR.value) || !Array.isArray(framesR.value)) {
      return null;
    }
    const phases = phasesR.value;
    const frames = framesR.value;

    const ballParsed = ballTrackingSchema.safeParse(data.ballTracking);
    const racketParsed = racketTrackingSchema.safeParse(data.racketTracking);

    return {
      phases,
      frames,
      ballTracking: ballParsed.success
        ? (ballParsed.data as BallTrackSample[])
        : [],
      racketTracking: racketParsed.success
        ? (racketParsed.data as RacketTrackSample[])
        : [],
      frameSync: buildFrameSyncIndex(frames, data.sampleFps),
    };
  }, [data]);

  const videoUrl = useMemo(() => {
    if (!data) return "";
    const key =
      data.videoStorageKey ??
      (data.videoFileName.startsWith("yt_") ? data.videoFileName : null);
    return key ? `/uploads/${key}` : "";
  }, [data]);

  const activePhase = useMemo<SwingPhaseType | undefined>(() => {
    if (!parsedData) return undefined;
    const frame = parsedData.frames[currentFrameIdx];
    if (!frame) return undefined;
    return getPhaseAtFrameIndex(parsedData.phases, frame.frameIndex)?.type;
  }, [parsedData, currentFrameIdx]);

  const handleSeek = useCallback((frameIndex: number) => {
    videoPlayerRef.current?.seekToFrameIndex(frameIndex);
  }, []);

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
        <p className="text-red-400 mb-4">
          {data && !parsedData
            ? "Analysis data is corrupted or unreadable."
            : "Analysis not found."}
        </p>
        <button
          onClick={() => navigate("/")}
          className="text-padel-green hover:underline"
        >
          Back to sessions
        </button>
      </div>
    );
  }

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
              {data.mode && data.mode in RECORD_MODE_LABELS
                ? ` · ${RECORD_MODE_LABELS[data.mode as RecordMode]}`
                : ""}
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
          <RallyPlaybackToggle
            onlyRallies={onlyRallies}
            onChange={setOnlyRallies}
            rallyCount={rallies.length}
            totalActiveMs={rallyQuery.data?.totalActiveMs ?? 0}
            videoDurationMs={
              rallyQuery.data?.durationMs ?? data.durationMs ?? 0
            }
            inFlight={rallyDetectionInFlight}
            failed={rallyDetectionFailed}
            audioAvailable={rallyQuery.data?.audioAvailable ?? false}
          />
          <div className="mb-3 flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-padel-surface border border-padel-border">
            <div className="flex flex-col">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                <Ruler className="w-4 h-4 text-padel-green" />
                Court calibration
              </div>
              <div className="text-xs text-slate-500">
                Align 4 court corners for real-world speed math.
              </div>
            </div>
            <button
              type="button"
              onClick={() => setCourtCalibrationEnabled((enabled) => !enabled)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors border ${
                courtCalibrationEnabled
                  ? "bg-padel-green text-black border-padel-green"
                  : "bg-slate-900 text-slate-300 border-padel-border hover:text-white"
              }`}
            >
              {courtCalibrationEnabled ? "Editing" : "Calibrate"}
            </button>
          </div>
          <VideoPlayer
            ref={videoPlayerRef}
            videoUrl={videoUrl}
            frames={parsedData.frames}
            phases={parsedData.phases}
            sampleFps={data.sampleFps}
            onFrameChange={setCurrentFrameIdx}
            rallies={rallies}
            onlyRallies={onlyRallies && rallies.length > 0}
            videoId={`${data.id}:${data.videoStorageKey ?? data.videoFileName}`}
            courtCalibrationEnabled={courtCalibrationEnabled}
            dominantSide={data.dominantSide}
            ballTracking={parsedData.ballTracking}
            racketTracking={parsedData.racketTracking}
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

/**
 * Compact, accessible toggle between the full source video and the
 * "Only Rallies" highlight playback mode.
 *
 * - Reads the rally-detection status from props so the parent owns network
 *   state. We never block on the detector — the toggle is visible even
 *   while detection is in flight (just disabled).
 * - When detection fails or the clip is too short for rallies (single-swing
 *   uploads), the toggle is hidden so we don't tease a feature that does
 *   nothing.
 */
function RallyPlaybackToggle({
  onlyRallies,
  onChange,
  rallyCount,
  totalActiveMs,
  videoDurationMs,
  inFlight,
  failed,
  audioAvailable,
}: {
  onlyRallies: boolean;
  onChange: (next: boolean) => void;
  rallyCount: number;
  totalActiveMs: number;
  videoDurationMs: number;
  inFlight: boolean;
  failed: boolean;
  audioAvailable: boolean;
}) {
  if (failed) {
    // Detection failed — likely a missing video file. Keep the surface clean.
    return null;
  }

  if (!inFlight && rallyCount === 0) {
    return null;
  }

  const trimRatio =
    videoDurationMs > 0
      ? Math.max(0, Math.min(1, 1 - totalActiveMs / videoDurationMs))
      : 0;

  return (
    <div className="mb-3 flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-padel-surface border border-padel-border">
      <div className="flex flex-col">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
          {onlyRallies ? (
            <Scissors className="w-4 h-4 text-padel-green" />
          ) : (
            <Film className="w-4 h-4 text-slate-400" />
          )}
          Playback mode
        </div>
        <div className="text-xs text-slate-500">
          {inFlight ? (
            "Detecting rally windows…"
          ) : (
            <>
              {rallyCount} rallies · {(totalActiveMs / 1000).toFixed(1)}s active
              {videoDurationMs > 0 ? ` · saves ${Math.round(trimRatio * 100)}%` : ""}
              {audioAvailable ? " · audio-aware" : ""}
            </>
          )}
        </div>
      </div>
      <div
        role="tablist"
        aria-label="Video playback mode"
        className="inline-flex rounded-lg border border-padel-border bg-slate-900 p-0.5"
      >
        <button
          type="button"
          role="tab"
          aria-selected={!onlyRallies}
          disabled={inFlight}
          onClick={() => onChange(false)}
          className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
            !onlyRallies
              ? "bg-slate-700 text-white"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          Full Video
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={onlyRallies}
          disabled={inFlight || rallyCount === 0}
          onClick={() => onChange(true)}
          className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
            onlyRallies
              ? "bg-padel-green text-black"
              : "text-slate-400 hover:text-slate-200"
          } ${rallyCount === 0 ? "opacity-40 cursor-not-allowed" : ""}`}
        >
          Only Rallies
        </button>
      </div>
    </div>
  );
}
