/* Hallmark · genre: modern-minimal (dark, data-led sports) · macrostructure: Workbench
 * mood: cinematic sports broadcast · design-system: design.md · designed-as-app
 * theme: studied-DNA "Court Flood" (source: image) · pre-emit critique: P5 H5 E5 S4 R4 V4 */
import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";
import { ArrowLeft, Ruler, Trophy } from "lucide-react";
import VideoPlayer, { type VideoPlayerHandle } from "@/components/VideoPlayer";
import PhaseTimeline from "@/components/PhaseTimeline";
import MetricsPanel from "@/components/MetricsPanel";
import ScoreCard from "@/components/ScoreCard";
import SwingCoachingPanel from "@/components/SwingCoachingPanel";
import AnalyzerFilterPanel from "@/components/analyzer/AnalyzerFilterPanel";
import AnalyzerScoreOverlay from "@/components/analyzer/AnalyzerScoreOverlay";
import { RallyPlaybackToggle } from "@/components/analyzer/RallyPlaybackToggle";
import { ShotTypeBadge } from "@/components/analyzer/ShotTypeBadge";
import type { RallyWindow } from "@shared/schema";
import type {
  BallTrackSample,
  FrameLandmarks,
  RacketTrackSample,
  SwingPhase,
  SwingPhaseType,
  RecordMode,
} from "@shared/types";
import { RECORD_MODE_LABELS } from "@shared/types";

export type ParsedAnalysisData = {
  phases: SwingPhase[];
  frames: FrameLandmarks[];
  ballTracking: BallTrackSample[];
  racketTracking: RacketTrackSample[];
};

export type AnalysisSessionMeta = {
  id: number;
  videoFileName: string;
  videoStorageKey: string | null;
  createdAt: string;
  dominantSide: "left" | "right";
  mode?: string | null;
  frameCount: number;
  durationMs: number;
  sampleFps: number;
  overallScore: number;
  shotType?: string | null;
  shotConfidence?: number | null;
};

export type RallyPlaybackMeta = {
  rallies: RallyWindow[];
  onlyRallies: boolean;
  onOnlyRalliesChange: (next: boolean) => void;
  rallyCount: number;
  totalActiveMs: number;
  videoDurationMs: number;
  inFlight: boolean;
  failed: boolean;
  audioAvailable: boolean;
};

export type PadelVideoAnalyzerProps = {
  analysis: AnalysisSessionMeta;
  parsedData: ParsedAnalysisData;
  videoUrl: string;
  videoPlayerRef: RefObject<VideoPlayerHandle | null>;
  currentFrameIdx: number;
  onFrameChange: (arrayIndex: number) => void;
  activePhase?: SwingPhaseType;
  rally: RallyPlaybackMeta;
  courtCalibrationEnabled: boolean;
  onCourtCalibrationEnabledChange: (enabled: boolean) => void;
  onSeek: (frameIndex: number) => void;
  onNavigateHome: () => void;
  onNavigateProCompare: () => void;
};

function extractPlayerIds(racketTracking: RacketTrackSample[]): number[] {
  const ids = new Set<number>();
  for (const sample of racketTracking) {
    ids.add(sample[1]);
  }
  return Array.from(ids).sort((a, b) => a - b);
}

function isTimeInRally(timeSec: number, rallies: RallyWindow[]): boolean {
  if (!Number.isFinite(timeSec) || rallies.length === 0) return false;
  const ms = timeSec * 1000;
  return rallies.some((r) => ms >= r.startMs && ms <= r.endMs);
}

export default function PadelVideoAnalyzer({
  analysis,
  parsedData,
  videoUrl,
  videoPlayerRef,
  currentFrameIdx,
  onFrameChange,
  activePhase,
  rally,
  courtCalibrationEnabled,
  onCourtCalibrationEnabledChange,
  onSeek,
  onNavigateHome,
  onNavigateProCompare,
}: PadelVideoAnalyzerProps) {
  const playerIds = useMemo(
    () => extractPlayerIds(parsedData.racketTracking),
    [parsedData.racketTracking]
  );

  const [selectedPlayerIds, setSelectedPlayerIds] = useState<Set<number>>(
    () => new Set(playerIds)
  );
  const [selectedStrokeTypes, setSelectedStrokeTypes] = useState<Set<string>>(
    () => new Set()
  );
  const [selectedSpinTypes, setSelectedSpinTypes] = useState<Set<string>>(
    () => new Set()
  );

  const currentFrame = parsedData.frames[currentFrameIdx];
  const currentFrameIndex = currentFrame?.frameIndex ?? 0;

  const currentTimeSec = useMemo(() => {
    if (!currentFrame) return 0;
    return currentFrame.timestamp / 1000;
  }, [currentFrame]);

  const durationSec = analysis.durationMs / 1000;

  const rallyActive = useMemo(
    () => isTimeInRally(currentTimeSec, rally.rallies),
    [currentTimeSec, rally.rallies]
  );

  useEffect(() => {
    if (playerIds.length === 0) {
      setSelectedPlayerIds(new Set());
      return;
    }
    setSelectedPlayerIds((prev) => {
      const next = new Set<number>();
      for (const id of playerIds) {
        if (prev.has(id)) next.add(id);
      }
      return next.size > 0 ? next : new Set(playerIds);
    });
  }, [playerIds]);

  const contactPhase = useMemo(
    () => parsedData.phases.find((p) => p.type === "contact"),
    [parsedData.phases]
  );

  const sessionShotType = analysis.shotType ?? null;

  const strokeFilterActive = selectedStrokeTypes.size > 0;
  const strokeFilterMatch =
    !strokeFilterActive ||
    (sessionShotType !== null && selectedStrokeTypes.has(sessionShotType));

  const playerFilterLabel = useMemo(() => {
    if (playerIds.length === 0) return null;
    if (selectedPlayerIds.size === playerIds.length) return null;
    if (selectedPlayerIds.size === 0) return "none";
    return Array.from(selectedPlayerIds)
      .sort((a, b) => a - b)
      .map((id) => `P${id}`)
      .join(", ");
  }, [playerIds.length, selectedPlayerIds]);

  const handleStrokeTypesChange = useCallback(
    (next: Set<string>) => {
      setSelectedStrokeTypes((prev) => {
        if (
          sessionShotType &&
          !prev.has(sessionShotType) &&
          next.has(sessionShotType) &&
          contactPhase
        ) {
          onSeek(contactPhase.startFrame);
        }
        return next;
      });
    },
    [sessionShotType, contactPhase, onSeek]
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3 border-l-2 border-accent pl-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onNavigateHome}
            className="p-2 rounded-full hover:bg-white/10 text-ink-2 hover:text-ink transition-colors shrink-0"
            aria-label="Back to sessions"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-2">
              Swing analysis
            </p>
            <h1 className="truncate font-display-condensed text-2xl text-ink">
              {analysis.videoFileName}
            </h1>
            <p className="text-xs text-muted-2">
              {new Date(analysis.createdAt).toLocaleDateString()} —{" "}
              {analysis.dominantSide === "right" ? "Right" : "Left"}-handed
              {analysis.mode && analysis.mode in RECORD_MODE_LABELS
                ? ` · ${RECORD_MODE_LABELS[analysis.mode as RecordMode]}`
                : ""}
            </p>
          </div>
        </div>
        <span className="rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-xs text-ink-2 tabular-nums">
          {analysis.frameCount} frames · {durationSec.toFixed(1)}s
        </span>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-6 items-start">
        {/* Cinematic video stage */}
        <section className="flex flex-col gap-3 min-w-0">
          <RallyPlaybackToggle
            onlyRallies={rally.onlyRallies}
            onChange={rally.onOnlyRalliesChange}
            rallyCount={rally.rallyCount}
            totalActiveMs={rally.totalActiveMs}
            videoDurationMs={rally.videoDurationMs}
            inFlight={rally.inFlight}
            failed={rally.failed}
            audioAvailable={rally.audioAvailable}
          />

          <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-2xl bg-surface border border-rule">
            <div className="flex flex-col">
              <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                <Ruler className="w-4 h-4 text-accent" />
                Court calibration
              </div>
              <div className="text-xs text-muted-2">
                Align 4 court corners for real-world speed math.
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                onCourtCalibrationEnabledChange(!courtCalibrationEnabled)
              }
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors border ${
                courtCalibrationEnabled
                  ? "bg-accent text-cta-ink border-accent"
                  : "bg-white/10 text-ink-2 border-white/15 hover:bg-white/15 hover:text-ink"
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
            sampleFps={analysis.sampleFps}
            onFrameChange={onFrameChange}
            rallies={rally.rallies}
            onlyRallies={rally.onlyRallies && rally.rallyCount > 0}
            videoId={`${analysis.id}:${analysis.videoStorageKey ?? analysis.videoFileName}`}
            courtCalibrationEnabled={courtCalibrationEnabled}
            dominantSide={analysis.dominantSide}
            ballTracking={parsedData.ballTracking}
            racketTracking={parsedData.racketTracking}
            selectedRacketPlayerIds={selectedPlayerIds}
            forceAspectRatio={16 / 9}
            suppressPhaseBadge
            stageOverlay={
              <AnalyzerScoreOverlay
                overallScore={analysis.overallScore}
                activePhase={activePhase}
                currentFrameIndex={currentFrameIndex}
                totalFrames={analysis.frameCount}
                currentTimeSec={currentTimeSec}
                durationSec={durationSec}
                rallyActive={rallyActive}
                playerFilterLabel={playerFilterLabel}
                strokeFilterActive={strokeFilterActive}
                strokeFilterMatch={strokeFilterMatch}
                activeShotType={sessionShotType}
              />
            }
          />

          <PhaseTimeline
            phases={parsedData.phases}
            totalFrames={analysis.frameCount}
            currentFrame={currentFrameIndex}
            onSeek={onSeek}
          />
        </section>

        {/* Right filter + metrics rail */}
        <aside className="flex flex-col gap-4 xl:sticky xl:top-20 xl:max-h-[calc(100dvh-6rem)] xl:overflow-y-auto">
          <AnalyzerFilterPanel
            playerIds={playerIds}
            selectedPlayerIds={selectedPlayerIds}
            onPlayerIdsChange={setSelectedPlayerIds}
            selectedStrokeTypes={selectedStrokeTypes}
            onStrokeTypesChange={handleStrokeTypesChange}
            selectedSpinTypes={selectedSpinTypes}
            onSpinTypesChange={setSelectedSpinTypes}
            activeShotType={analysis.shotType ?? null}
          />

          <div className="overflow-hidden rounded-2xl border border-rule bg-surface">
            <div className="h-1 bg-accent" />
            <div className="flex items-center justify-between gap-3 p-4">
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-2">
                  Overall score
                </p>
                <ScoreCard score={analysis.overallScore} size="lg" />
              </div>
              <div className="flex flex-col items-end gap-2">
                <ShotTypeBadge
                  shotType={analysis.shotType ?? null}
                  confidence={analysis.shotConfidence ?? null}
                  analysisId={analysis.id}
                />
                <button
                  type="button"
                  onClick={onNavigateProCompare}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-sand/40 text-sand hover:bg-sand/10 transition-colors text-xs"
                >
                  <Trophy className="w-3.5 h-3.5" />
                  Compare with Pro
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <p className="px-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-2">
              Coaching
            </p>
            <SwingCoachingPanel phases={parsedData.phases} />
          </div>

          <div className="flex flex-col gap-2">
            <p className="px-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-2">
              Metrics
            </p>
            <MetricsPanel phases={parsedData.phases} activePhase={activePhase} />
          </div>
        </aside>
      </div>
    </div>
  );
}
