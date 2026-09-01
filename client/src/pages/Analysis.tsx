/* Hallmark · genre: modern-minimal (dark, data-led sports) · macrostructure: Workbench (page shell)
 * design-system: design.md · designed-as-app · theme: studied-DNA "Court Flood" (source: image)
 * Shell only — PadelVideoAnalyzer owns the stage/rail layout.
 * pre-emit critique: P5 H4 E5 S4 R5 V4 */
import { useState, useCallback, useMemo, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { motion } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { type VideoPlayerHandle } from "@/components/VideoPlayer";
import PadelVideoAnalyzer from "@/components/PadelVideoAnalyzer";
import { buildFrameSyncIndex, getPhaseAtFrameIndex } from "@/lib/frameSync";
import { tryParseJson } from "@/lib/safeJson";
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
} from "@shared/types";
import {
  getDemoAnalysisData,
  isDemoAnalysisId,
} from "@/lib/sampleAnalysis";

export default function Analysis() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const [currentFrameIdx, setCurrentFrameIdx] = useState(0);
  const [onlyRallies, setOnlyRallies] = useState(false);
  const [courtCalibrationEnabled, setCourtCalibrationEnabled] = useState(false);
  const videoPlayerRef = useRef<VideoPlayerHandle>(null);

  const isDemo = isDemoAnalysisId(id);
  const analysisId = Number(id);
  const { data: remoteData, isLoading, error } = trpc.analysis.getById.useQuery(
    { id: analysisId, includeLandmarks: true },
    { enabled: !!id && !isDemo && Number.isFinite(analysisId) && analysisId > 0 }
  );
  const data = isDemo ? getDemoAnalysisData() : remoteData;

  const rallyQuery = trpc.analysis.getRallies.useQuery(
    { analysisId },
    {
      enabled:
        !isDemo && !!id && Number.isFinite(analysisId) && analysisId > 0,
      retry: false,
      staleTime: 5 * 60 * 1000,
    }
  );
  const rallies = rallyQuery.data?.rallies ?? [];

  const showLowDetectionWarning =
    !isDemo &&
    remoteData?.qualityWarning === "low_detection";

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

  if (!isDemo && isLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if ((!isDemo && error) || !data || !parsedData) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-2">
          {data && !parsedData ? "Unreadable session" : "Not found"}
        </p>
        <h1 className="mt-2 font-display-condensed text-2xl text-ink">
          {data && !parsedData
            ? "This analysis can't be read"
            : "Analysis not found"}
        </h1>
        <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-ink-2">
          {data && !parsedData
            ? "The stored tracking data is corrupted or unreadable. Try re-running the analysis."
            : "This session may have been deleted or never finished processing."}
        </p>
        <button
          type="button"
          onClick={() => navigate("/app")}
          className="mt-6 inline-flex min-h-11 items-center justify-center rounded-full border border-white/15 bg-white/10 px-5 font-semibold text-ink transition-colors hover:bg-white/15"
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
      className="max-w-[1600px] mx-auto px-4 py-6"
    >
      {showLowDetectionWarning ? (
        <div className="mb-4 rounded-2xl border border-sand/40 bg-sand/10 px-4 py-3 text-sm text-sand">
          Low pose detection rate on this clip — scores and overlay may be less reliable.
        </div>
      ) : null}
      <PadelVideoAnalyzer
        analysis={{
          id: data.id,
          videoFileName: data.videoFileName,
          videoStorageKey: data.videoStorageKey ?? null,
          createdAt: data.createdAt,
          dominantSide: data.dominantSide,
          mode: data.mode,
          frameCount: data.frameCount,
          durationMs: data.durationMs,
          sampleFps: data.sampleFps,
          overallScore: data.overallScore,
          shotType: data.shotType,
          shotConfidence: data.shotConfidence,
        }}
        parsedData={{
          phases: parsedData.phases,
          frames: parsedData.frames,
          ballTracking: parsedData.ballTracking,
          racketTracking: parsedData.racketTracking,
        }}
        videoUrl={videoUrl}
        videoPlayerRef={videoPlayerRef}
        currentFrameIdx={currentFrameIdx}
        onFrameChange={setCurrentFrameIdx}
        activePhase={activePhase}
        rally={{
          rallies,
          onlyRallies,
          onOnlyRalliesChange: setOnlyRallies,
          rallyCount: rallies.length,
          totalActiveMs: rallyQuery.data?.totalActiveMs ?? 0,
          videoDurationMs: rallyQuery.data?.durationMs ?? data.durationMs ?? 0,
          inFlight: rallyQuery.isLoading,
          failed: !!rallyQuery.error,
          audioAvailable: rallyQuery.data?.audioAvailable ?? false,
        }}
        courtCalibrationEnabled={courtCalibrationEnabled}
        onCourtCalibrationEnabledChange={setCourtCalibrationEnabled}
        onSeek={handleSeek}
        onNavigateHome={() => navigate("/app")}
        onNavigateProCompare={() => navigate(`/app/pro-compare?player=${data.id}`)}
      />
    </motion.div>
  );
}
