import {
  forwardRef,
  useRef,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useImperativeHandle,
} from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Eye,
  EyeOff,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import CourtCalibrationOverlay from "@/components/CourtCalibrationOverlay";
import { useVideoOverlayWorker } from "@/hooks/useVideoOverlayWorker";
import { useVideoFrameSync } from "@/hooks/useVideoFrameSync";
import {
  usePlaybackSpeeds,
  type PlaybackSpeedDisplay,
  type RacketSpeedSource,
} from "@/hooks/usePlaybackSpeeds";
import {
  buildFrameSyncIndex,
  frameIndexToTimeSec,
  getPhaseAtFrameIndex,
  resolveArrayIndexForFrameIndex,
  resolveFrameAtTime,
  type FrameSyncIndex,
} from "@/lib/frameSync";
import { buildBallPositionsForFrames } from "@/lib/ballTracking";
import { buildRacketPositionsForFrames } from "@/lib/racketTracking";
import type {
  BallTrackSample,
  FrameLandmarks,
  RacketTrackSample,
  SwingPhase,
  SwingPhaseType,
} from "@shared/types";
import { PHASE_LABELS, PHASE_COLORS } from "@shared/types";
import type { RallyWindow } from "@shared/schema";
import type {
  CourtCalibration,
  HomographyMatrix,
} from "@/lib/courtCalibration";

export type VideoPlayerHandle = {
  seekToFrameIndex: (frameIndex: number) => void;
  seekToTimeSec: (timeSec: number) => void;
};

type Props = {
  videoUrl: string;
  frames: FrameLandmarks[];
  phases: SwingPhase[];
  sampleFps: number;
  onFrameChange?: (arrayIndex: number) => void;
  /** Optional rally windows used to render the segment strip + power "Only Rallies" playback. */
  rallies?: RallyWindow[];
  /** When true, the player skips dead time between rallies during playback. */
  onlyRallies?: boolean;
  /** Stable identifier used to persist court calibration points for this source video. */
  videoId?: string;
  /** When true, shows the draggable 4-corner court calibration overlay. */
  courtCalibrationEnabled?: boolean;
  /** When false, renders persisted calibration read-only. */
  courtCalibrationEditable?: boolean;
  /** Dominant hand used for the wrist fallback when no racket tracker is available. */
  dominantSide?: "left" | "right";
  /** Raw [frameIndex, imageX, imageY, confidence] samples from the server CV tracker. */
  ballTracking?: BallTrackSample[];
  /** Optional normalized ball x,y pairs aligned to the frames array. */
  ballPositions?: Float32Array;
  /**
   * Raw `[frameIndex, playerId, imageX, imageY, confidence]` samples
   * from the server CV racket-head tracker. Optional — falls back to
   * the dominant wrist proxy for older sessions.
   */
  racketTracking?: RacketTrackSample[];
  /** Optional normalized racket x,y pairs aligned to the frames array. */
  racketPositions?: Float32Array;
  onCourtCalibrationChange?: (
    calibration: CourtCalibration,
    homography: HomographyMatrix | null
  ) => void;
};

function VideoPlayerInner(
  {
    videoUrl,
    frames,
    phases,
    sampleFps,
    onFrameChange,
    rallies,
    onlyRallies = false,
    videoId,
    courtCalibrationEnabled = false,
    courtCalibrationEditable = true,
    dominantSide = "right",
    ballTracking,
    ballPositions,
    racketTracking,
    racketPositions,
    onCourtCalibrationChange,
  }: Props,
  ref: React.ForwardedRef<VideoPlayerHandle>
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [playing, setPlaying] = useState(false);
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [videoDurationSec, setVideoDurationSec] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [dimensions, setDimensions] = useState({ w: 640, h: 480 });
  const [activePhaseType, setActivePhaseType] = useState<SwingPhaseType>();
  const [contactFlash, setContactFlash] = useState(false);
  const [calibratedHomography, setCalibratedHomography] =
    useState<HomographyMatrix | null>(null);

  const frameSync = useMemo(
    () => buildFrameSyncIndex(frames, sampleFps),
    [frames, sampleFps]
  );

  const frameSyncRef = useRef(frameSync);
  frameSyncRef.current = frameSync;

  const effectiveBallPositions = useMemo(
    () =>
      ballPositions ??
      buildBallPositionsForFrames(frames, ballTracking, frameSync, dimensions),
    [ballPositions, ballTracking, dimensions, frameSync, frames]
  );

  const effectiveRacketPositions = useMemo(
    () =>
      racketPositions ??
      buildRacketPositionsForFrames(
        frames,
        racketTracking,
        frameSync,
        dimensions
      ),
    [racketPositions, racketTracking, dimensions, frameSync, frames]
  );

  const showSkeletonRef = useRef(showSkeleton);
  showSkeletonRef.current = showSkeleton;

  const phasesRef = useRef(phases);
  phasesRef.current = phases;

  const onFrameChangeRef = useRef(onFrameChange);
  onFrameChangeRef.current = onFrameChange;

  const prevPhaseRef = useRef<SwingPhaseType | undefined>(undefined);
  const lastUiFrameRef = useRef(-1);

  const { paintOverlay, resetRenderCache } = useVideoOverlayWorker({
    canvasRef,
    frames,
    dimensions,
    showSkeleton,
    ballPositions: effectiveBallPositions,
  });

  const paintOverlayRef = useRef(paintOverlay);
  paintOverlayRef.current = paintOverlay;

  const {
    display: speedDisplay,
    racketSpeedSource,
    processFrame: processPlaybackSpeeds,
    reset: resetPlaybackSpeeds,
  } = usePlaybackSpeeds({
    homography: calibratedHomography,
    fps: sampleFps,
    dimensions,
    dominantSide,
    ballPositions: effectiveBallPositions,
    racketPositions: effectiveRacketPositions,
  });

  const processPlaybackSpeedsRef = useRef(processPlaybackSpeeds);
  processPlaybackSpeedsRef.current = processPlaybackSpeeds;

  const resetPlaybackSpeedsRef = useRef(resetPlaybackSpeeds);
  resetPlaybackSpeedsRef.current = resetPlaybackSpeeds;

  const handleCourtCalibrationChange = useCallback(
    (calibration: CourtCalibration, homography: HomographyMatrix | null) => {
      setCalibratedHomography(homography);
      onCourtCalibrationChange?.(calibration, homography);
    },
    [onCourtCalibrationChange]
  );

  const applyFrameIndex = useCallback(
    (arrayIdx: number, sync: FrameSyncIndex) => {
      const frame = sync.frames[arrayIdx];
      const phase = frame
        ? getPhaseAtFrameIndex(phasesRef.current, frame.frameIndex)
        : undefined;
      const highlightContact = phase?.type === "contact";

      paintOverlayRef.current(arrayIdx, {
        visible: showSkeletonRef.current,
        highlightContact,
      });
      processPlaybackSpeedsRef.current(arrayIdx, sync);

      if (arrayIdx === lastUiFrameRef.current) return;
      lastUiFrameRef.current = arrayIdx;

      setCurrentFrame(arrayIdx);
      onFrameChangeRef.current?.(arrayIdx);

      if (!frame) return;

      const newPhaseType = phase?.type;
      setActivePhaseType(newPhaseType);

      if (newPhaseType === "contact" && prevPhaseRef.current !== "contact") {
        setContactFlash(true);
        window.setTimeout(() => setContactFlash(false), 300);
      }
      prevPhaseRef.current = newPhaseType;
    },
    []
  );

  const applyFrameIndexRef = useRef(applyFrameIndex);
  applyFrameIndexRef.current = applyFrameIndex;

  const { syncToCurrentTime, resetSyncCache, cancelFrameLoop } =
    useVideoFrameSync({
      videoRef,
      frameSyncRef,
      playing,
      onlyRallies,
      rallies,
      callbacks: {
        onFrameIndex: (arrayIdx, sync) => {
          applyFrameIndexRef.current(arrayIdx, sync);
        },
        onTimeSec: setCurrentTimeSec,
      },
    });

  useImperativeHandle(
    ref,
    () => ({
      seekToFrameIndex(frameIndex: number) {
        const video = videoRef.current;
        const sync = frameSyncRef.current;
        if (!video || sync.frames.length === 0) return;

        const arrayIdx = resolveArrayIndexForFrameIndex(sync, frameIndex);
        const timeSec = frameIndexToTimeSec(sync, frameIndex);

        video.pause();
        setPlaying(false);
        cancelFrameLoop();
        video.currentTime = timeSec;
        resetSyncCache();
        lastUiFrameRef.current = -1;
        resetPlaybackSpeedsRef.current();
        applyFrameIndexRef.current(arrayIdx, sync);
        setCurrentTimeSec(timeSec);
      },
      seekToTimeSec(timeSec: number) {
        const video = videoRef.current;
        if (!video) return;
        video.pause();
        setPlaying(false);
        cancelFrameLoop();
        video.currentTime = Math.max(0, timeSec);
        resetSyncCache();
        lastUiFrameRef.current = -1;
        resetPlaybackSpeedsRef.current();
        syncToCurrentTime({ forceTimeUi: true });
      },
    }),
    [cancelFrameLoop, resetSyncCache, syncToCurrentTime]
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onMeta = () => {
      setDimensions({ w: video.videoWidth, h: video.videoHeight });
      setVideoDurationSec(Number.isFinite(video.duration) ? video.duration : 0);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);

    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);

    return () => {
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
    };
  }, []);

  useEffect(() => {
    resetSyncCache();
    lastUiFrameRef.current = -1;
    resetRenderCache();
    syncToCurrentTime({ forceTimeUi: true });
  }, [frameSync, resetRenderCache, resetSyncCache, syncToCurrentTime]);

  useEffect(() => {
    resetRenderCache();
    applyFrameIndexRef.current(currentFrame, frameSyncRef.current);
  }, [showSkeleton, currentFrame, resetRenderCache]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      void v.play();
    } else {
      v.pause();
    }
  };

  const stepFrame = (dir: -1 | 1) => {
    const v = videoRef.current;
    const sync = frameSyncRef.current;
    if (!v || sync.frames.length === 0) return;

    v.pause();
    setPlaying(false);
    cancelFrameLoop();

    const currentIdx = resolveFrameAtTime(sync, v.currentTime);
    const nextIdx = Math.max(
      0,
      Math.min(sync.frames.length - 1, currentIdx + dir)
    );
    v.currentTime = sync.timestampsSec[nextIdx] ?? 0;
    resetSyncCache();
    lastUiFrameRef.current = -1;
    resetPlaybackSpeedsRef.current();
    applyFrameIndexRef.current(nextIdx, sync);
    setCurrentTimeSec(v.currentTime);
  };

  const speeds = [0.1, 0.25, 0.5, 1, 2];
  const changeSpeed = () => {
    const next = speeds[(speeds.indexOf(playbackRate) + 1) % speeds.length]!;
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
      <div
        className="relative"
        style={{ aspectRatio: `${dimensions.w}/${dimensions.h}` }}
      >
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
        {videoId && (
          <CourtCalibrationOverlay
            videoId={videoId}
            videoWidth={dimensions.w}
            videoHeight={dimensions.h}
            enabled={courtCalibrationEnabled}
            editable={courtCalibrationEditable}
            videoRef={videoRef}
            onCalibrationChange={handleCourtCalibrationChange}
          />
        )}

        <LiveSpeedDash
          display={speedDisplay}
          calibrated={Boolean(calibratedHomography)}
          ballAvailable={Boolean(effectiveBallPositions)}
          racketSource={racketSpeedSource}
        />

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
                background:
                  "radial-gradient(ellipse at center, rgba(255,255,255,0.18) 0%, transparent 70%)",
              }}
            />
          )}
        </AnimatePresence>

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

      {rallies && rallies.length > 0 && videoDurationSec > 0 && (
        <RallySegmentStrip
          rallies={rallies}
          videoDurationSec={videoDurationSec}
          currentTimeSec={currentTimeSec}
          onlyRallies={onlyRallies}
          onSeek={(timeSec) => {
            const video = videoRef.current;
            if (!video) return;
            video.currentTime = Math.max(0, timeSec);
            resetSyncCache();
            lastUiFrameRef.current = -1;
            resetPlaybackSpeedsRef.current();
            syncToCurrentTime({ forceTimeUi: true });
          }}
        />
      )}

      {activePhaseType && phases.length > 0 && (
        <div className="h-1 w-full bg-slate-800">
          {phases.map((phase) => {
            const left =
              (phase.startFrame / (phases[phases.length - 1]?.endFrame || 1)) *
              100;
            const width =
              ((phase.endFrame - phase.startFrame) /
                (phases[phases.length - 1]?.endFrame || 1)) *
              100;
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

      <div className="flex items-center gap-2 p-3 bg-slate-900/90 backdrop-blur">
        <button
          type="button"
          onClick={() => stepFrame(-1)}
          className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
        >
          <SkipBack className="w-4 h-4" />
        </button>
        <button
          type="button"
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
          type="button"
          onClick={() => stepFrame(1)}
          className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
        >
          <SkipForward className="w-4 h-4" />
        </button>

        <button
          type="button"
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
          type="button"
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

const VideoPlayer = forwardRef(VideoPlayerInner);
export default VideoPlayer;

type LiveSpeedDashProps = {
  display: PlaybackSpeedDisplay;
  calibrated: boolean;
  ballAvailable: boolean;
  racketSource: RacketSpeedSource;
};

function SpeedReadout({
  label,
  value,
  unavailableLabel,
}: {
  label: string;
  value: number | null;
  unavailableLabel?: string;
}) {
  return (
    <div className="min-w-[94px] rounded-lg border border-white/10 bg-slate-950/65 px-3 py-2 shadow-[0_0_20px_rgba(15,23,42,0.35)]">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
        {label}
      </div>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <span className="font-mono text-2xl font-bold leading-none text-white tabular-nums">
          {value == null ? "--" : value}
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-padel-green">
          km/h
        </span>
      </div>
      {value == null && unavailableLabel && (
        <div className="mt-1 text-[9px] uppercase tracking-wider text-slate-500">
          {unavailableLabel}
        </div>
      )}
    </div>
  );
}

function LiveSpeedDash({
  display,
  calibrated,
  ballAvailable,
  racketSource,
}: LiveSpeedDashProps) {
  const racketUnavailableLabel =
    racketSource === "racket-tracker"
      ? "Tracking lost"
      : racketSource === "wrist-proxy"
        ? "Wrist proxy lost"
        : "Tracker pending";
  const racketSourceLabel =
    racketSource === "racket-tracker"
      ? "racket-head tracker"
      : racketSource === "wrist-proxy"
        ? "wrist proxy"
        : "racket source pending";

  return (
    <div className="pointer-events-none absolute right-3 top-3 z-10 flex flex-col items-end gap-2">
      <div className="rounded-2xl border border-padel-green/25 bg-slate-950/55 p-1.5 shadow-2xl backdrop-blur-md">
        <div className="flex items-stretch gap-1.5">
          <SpeedReadout
            label="Ball Speed"
            value={display.ballKmh}
            unavailableLabel={ballAvailable ? "Tracking lost" : "No ball track"}
          />
          <SpeedReadout
            label="Racket Speed"
            value={display.racketKmh}
            unavailableLabel={racketUnavailableLabel}
          />
        </div>
      </div>
      <div className="rounded-full border border-white/10 bg-black/35 px-2 py-0.5 text-[10px] font-medium text-slate-400 backdrop-blur">
        {calibrated ? "Court-calibrated" : "Calibration pending"} · {racketSourceLabel}
      </div>
    </div>
  );
}

type RallySegmentStripProps = {
  rallies: RallyWindow[];
  videoDurationSec: number;
  currentTimeSec: number;
  onlyRallies: boolean;
  onSeek: (timeSec: number) => void;
};

/**
 * Compact timeline strip that visualises rally windows over the full video
 * duration. Non-rally regions are dimmed so the rallies "pop" while the
 * dead-time context is still legible. Click-to-seek lands you at the start
 * of a rally, with a tiny epsilon so playback resumes *inside* the window.
 */
function RallySegmentStrip({
  rallies,
  videoDurationSec,
  currentTimeSec,
  onlyRallies,
  onSeek,
}: RallySegmentStripProps) {
  const duration = Math.max(videoDurationSec, 1);
  return (
    <div className="relative h-2 w-full bg-slate-900/80 border-y border-padel-border/70">
      {/* dimmed full-width background indicates dead time */}
      <div className="absolute inset-0 bg-slate-900 opacity-70 pointer-events-none" />
      {rallies.map((rally) => {
        const startSec = rally.startMs / 1000;
        const endSec = rally.endMs / 1000;
        const left = Math.max(0, Math.min(100, (startSec / duration) * 100));
        const width = Math.max(
          0.4,
          Math.min(100 - left, ((endSec - startSec) / duration) * 100)
        );
        const isCurrent =
          currentTimeSec * 1000 >= rally.startMs &&
          currentTimeSec * 1000 <= rally.endMs;
        const intensity = 0.45 + 0.55 * rally.confidence;
        return (
          <button
            key={rally.id}
            type="button"
            onClick={() => onSeek(startSec + 0.001)}
            title={`Rally ${rally.id + 1} · ${startSec.toFixed(1)}s – ${endSec.toFixed(
              1
            )}s · ${(rally.confidence * 100).toFixed(0)}% confidence`}
            className="absolute top-0 h-full transition-opacity hover:opacity-100"
            style={{
              left: `${left}%`,
              width: `${width}%`,
              backgroundColor: isCurrent ? "#a3e635" : "#4ade80",
              opacity: isCurrent ? 1 : intensity,
              boxShadow: isCurrent
                ? "0 0 6px rgba(163, 230, 53, 0.7)"
                : undefined,
            }}
          />
        );
      })}
      {/* current-time playhead */}
      <div
        className="absolute top-0 h-full w-px bg-white/90 pointer-events-none"
        style={{
          left: `${Math.max(0, Math.min(100, (currentTimeSec / duration) * 100))}%`,
        }}
      />
      {onlyRallies && (
        <div
          className="absolute -top-1 right-2 px-1.5 py-0.5 rounded-sm text-[9px] font-semibold uppercase tracking-wider bg-padel-green text-black pointer-events-none"
          style={{ transform: "translateY(-100%)" }}
        >
          Only Rallies
        </div>
      )}
    </div>
  );
}
