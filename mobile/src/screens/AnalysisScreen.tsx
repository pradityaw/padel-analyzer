import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Video, ResizeMode } from "expo-av";
import Svg, { Line, Circle, Rect } from "react-native-svg";
import SectionCard from "../components/SectionCard";
import { getAnalysisById, getCvStatus, triggerCvPipeline } from "../lib/api";
import { resolveUploadUrl } from "../lib/mediaUrl";
import {
  getDemoAnalysisDetail,
  isDemoAnalysisId,
} from "../lib/sampleAnalysis";
import type { RootStackParamList } from "../lib/navigation";
import type {
  AnalysisPhase,
  CvMatchResult,
  CvScoringResult,
  HeatmapPlayer,
} from "../lib/types";
import { SKELETON_CONNECTIONS } from "../lib/skeletonConnections";
import {
  buildBallFrameMap,
  computeBallSpeedPxPerFrame,
  findPriorBallSample,
  formatBallSpeedLabel,
  getBallForFrameIndex,
  parseBallTrackingSamples,
} from "../lib/ballTracking";

/** Server match-CV pipeline not wired on this branch yet. */
const MATCH_CV_ENABLED = false;

type Props = NativeStackScreenProps<RootStackParamList, "Analysis">;

type Landmark = { x: number; y: number; z: number; visibility: number };
type FrameLm = { frameIndex: number; timestamp: number; landmarks: Landmark[] };

function formatDuration(durationMs: number) {
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function collectHeatmapPlayers(cvResult: CvMatchResult | null): HeatmapPlayer[] {
  if (!cvResult?.rallies?.length) return [];
  const map = new Map<number, HeatmapPlayer>();
  for (const rally of cvResult.rallies) {
    for (const player of rally.player_heatmaps) {
      if (!map.has(player.player_id)) map.set(player.player_id, player);
    }
  }
  return [...map.values()];
}

function MobileHeatmap({ players }: { players: HeatmapPlayer[] }) {
  const player = players.find((p) => (p.heatmap?.length ?? 0) > 0);
  if (!player?.heatmap?.length) {
    return <Text style={styles.metaText}>No heatmap data yet.</Text>;
  }
  const rows = player.heatmap.length;
  const cols = player.heatmap[0]?.length ?? 1;
  const cellW = 280 / cols;
  const cellH = 140 / rows;
  return (
    <Svg width={280} height={140} style={{ marginTop: 12 }}>
      {player.heatmap.map((row, r) =>
        row.map((value, c) => (
          <Rect
            key={`${r}-${c}`}
            x={c * cellW}
            y={r * cellH}
            width={cellW}
            height={cellH}
            fill={`rgba(163,230,53,${0.15 + Math.min(1, value) * 0.85})`}
          />
        ))
      )}
    </Svg>
  );
}

function nearestFrame(frames: FrameLm[], timeMs: number): FrameLm | null {
  if (frames.length === 0) return null;
  let best = frames[0]!;
  let bestD = Math.abs(best.timestamp - timeMs);
  for (let i = 1; i < frames.length; i++) {
    const f = frames[i]!;
    const d = Math.abs(f.timestamp - timeMs);
    if (d < bestD) {
      best = f;
      bestD = d;
    }
  }
  return best;
}

export default function AnalysisScreen({ route }: Props) {
  const { analysisId } = route.params;
  const isDemo = isDemoAnalysisId(analysisId);
  const query = useQuery({
    queryKey: ["analysis", analysisId],
    queryFn: () => getAnalysisById(analysisId),
    enabled: !isDemo,
  });

  const [videoSize, setVideoSize] = useState({ w: 320, h: 180 });
  const [playbackMs, setPlaybackMs] = useState(0);
  const [demoFrameIdx, setDemoFrameIdx] = useState(0);
  const [useCondensedVideo, setUseCondensedVideo] = useState(false);
  const [cvActionError, setCvActionError] = useState<string | null>(null);
  const autoCvTriggered = useRef(false);

  const analysis = isDemo ? getDemoAnalysisDetail() : query.data;
  const cvStatus = analysis?.cvStatus ?? null;
  const cvPoll = useQuery({
    queryKey: ["cv-status", analysisId],
    queryFn: () => getCvStatus(analysisId),
    enabled:
      MATCH_CV_ENABLED &&
      !isDemo &&
      (cvStatus === "pending" || cvStatus === "running"),
    refetchInterval: 2000,
  });

  const cvResult: CvMatchResult | null =
    cvPoll.data?.cvResult ?? analysis?.cvResult ?? null;
  const liveCvStatus = cvPoll.data?.cvStatus ?? cvStatus;

  const scoring = useMemo((): CvScoringResult | null => {
    const raw = cvResult?.raw?.scoring;
    if (!raw || typeof raw !== "object") return null;
    return raw as CvScoringResult;
  }, [cvResult?.raw?.scoring]);

  useFocusEffect(
    useCallback(() => {
      if (isDemo) return;
      void query.refetch();
      if (cvStatus === "pending" || cvStatus === "running") {
        void cvPoll.refetch();
      }
    }, [isDemo, query, cvPoll, cvStatus])
  );

  useEffect(() => {
    if (!MATCH_CV_ENABLED || isDemo || !analysis?.videoStorageKey) return;
    if (cvStatus != null || autoCvTriggered.current) return;
    autoCvTriggered.current = true;
    void triggerCvPipeline(analysisId)
      .then(() => {
        void query.refetch();
        void cvPoll.refetch();
      })
      .catch((err) => {
        setCvActionError(
          err instanceof Error ? err.message : "Could not start match analysis."
        );
      });
  }, [isDemo, analysis?.videoStorageKey, analysisId, cvStatus, query, cvPoll]);

  const runMatchCv = useCallback(async () => {
    setCvActionError(null);
    try {
      await triggerCvPipeline(analysisId);
      await query.refetch();
      await cvPoll.refetch();
    } catch (err) {
      setCvActionError(
        err instanceof Error ? err.message : "Could not start match analysis."
      );
    }
  }, [analysisId, query, cvPoll]);

  const phases = useMemo<AnalysisPhase[]>(() => {
    const raw = analysis?.phasesJson;
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [analysis?.phasesJson]);

  const frames = useMemo<FrameLm[]>(() => {
    const raw = analysis?.landmarksJson;
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [analysis?.landmarksJson]);

  useEffect(() => {
    if (!isDemo || frames.length === 0) return;
    const id = setInterval(() => {
      setDemoFrameIdx((i) => (i + 1) % frames.length);
    }, 66);
    return () => clearInterval(id);
  }, [isDemo, frames.length]);

  const activeFrame = useMemo(() => {
    if (isDemo && frames[demoFrameIdx]) return frames[demoFrameIdx]!;
    return nearestFrame(frames, playbackMs);
  }, [frames, playbackMs, isDemo, demoFrameIdx]);

  const activeLandmarks = activeFrame?.landmarks ?? null;

  const ballFrameMap = useMemo(
    () =>
      buildBallFrameMap(
        parseBallTrackingSamples(analysis?.ballTracking),
        { w: videoSize.w, h: videoSize.h }
      ),
    [analysis?.ballTracking, videoSize.w, videoSize.h]
  );

  const activeBall = useMemo(
    () => getBallForFrameIndex(ballFrameMap, activeFrame?.frameIndex),
    [ballFrameMap, activeFrame?.frameIndex]
  );

  const ballTrackingAvailable = ballFrameMap.size > 0;
  const showBallTrackingUnavailable =
    !isDemo && frames.length > 0 && !ballTrackingAvailable;

  const ballSpeedLabel = useMemo(() => {
    if (!activeFrame || !activeBall) return null;
    const prior = findPriorBallSample(ballFrameMap, activeFrame.frameIndex);
    if (!prior) return null;
    const frameDelta = activeFrame.frameIndex - prior.frameIndex;
    const pxPerFrame = computeBallSpeedPxPerFrame(
      prior.point,
      activeBall,
      frameDelta
    );
    return formatBallSpeedLabel(pxPerFrame, analysis?.sampleFps ?? 30, null);
  }, [activeFrame, activeBall, ballFrameMap, analysis?.sampleFps]);

  const onVideoLayout = useCallback(
    (e: { nativeEvent: { layout: { width: number; height: number } } }) => {
      const { width, height } = e.nativeEvent.layout;
      if (width > 0 && height > 0) {
        setVideoSize({ w: width, h: height });
      }
    },
    []
  );

  const replayUrl = useMemo(() => {
    if (isDemo || !analysis) return null;
    if (useCondensedVideo && cvResult?.trimmed_video_url) {
      return resolveUploadUrl(cvResult.trimmed_video_url);
    }
    if (analysis.videoStorageKey) {
      return resolveUploadUrl(`/uploads/${analysis.videoStorageKey}`);
    }
    return null;
  }, [
    isDemo,
    analysis,
    useCondensedVideo,
    cvResult?.trimmed_video_url,
  ]);

  if (!isDemo && query.isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#a3e635" />
      </View>
    );
  }

  if (!analysis) {
    return (
      <View style={styles.centered}>
        <Text style={styles.title}>Analysis not found</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <SectionCard
        title={analysis.videoFileName}
        subtitle={new Date(analysis.createdAt).toLocaleString()}
        right={<Text style={styles.score}>{analysis.overallScore}</Text>}
      >
        <Text style={styles.metaText}>
          {analysis.dominantSide}-handed • {analysis.frameCount} frames •{" "}
          {formatDuration(analysis.durationMs)}
        </Text>
        {analysis.shotType ? (
          <Text style={styles.badge}>Shot: {analysis.shotType}</Text>
        ) : null}
        {analysis.skillLabel ? (
          <Text style={styles.badge}>
            Skill: {analysis.skillLabel} ({analysis.qualityScore ?? 0})
          </Text>
        ) : null}
        {showBallTrackingUnavailable ? (
          <Text style={styles.trackingHint}>
            Ball tracking unavailable for this session (pose replay still works).
            Racket speed is web-only in this beta.
          </Text>
        ) : null}
        {replayUrl ? (
          <View style={styles.videoWrap} onLayout={onVideoLayout}>
            <Video
              style={styles.video}
              source={{ uri: replayUrl }}
              useNativeControls
              resizeMode={ResizeMode.CONTAIN}
              isLooping
              onPlaybackStatusUpdate={(status) => {
                if (!status.isLoaded) return;
                if (typeof status.positionMillis === "number") {
                  setPlaybackMs(status.positionMillis);
                }
              }}
            />
            {activeLandmarks ? (
              <View
                style={[styles.overlay, { width: videoSize.w, height: videoSize.h }]}
                pointerEvents="none"
              >
                <Svg width={videoSize.w} height={videoSize.h} viewBox="0 0 1 1">
                  {SKELETON_CONNECTIONS.map(([a, b], idx) => {
                    const la = activeLandmarks[a];
                    const lb = activeLandmarks[b];
                    if (!la || !lb) return null;
                    if (la.visibility < 0.3 || lb.visibility < 0.3) return null;
                    return (
                      <Line
                        key={`${idx}-${a}-${b}`}
                        x1={la.x}
                        y1={la.y}
                        x2={lb.x}
                        y2={lb.y}
                        stroke="#a3e635"
                        strokeWidth={0.004}
                        strokeOpacity={0.85}
                      />
                    );
                  })}
                  {activeLandmarks.map((lm, i) => {
                    if (lm.visibility < 0.3) return null;
                    return (
                      <Circle
                        key={`pt-${i}`}
                        cx={lm.x}
                        cy={lm.y}
                        r={0.012}
                        fill="#f8fafc"
                        fillOpacity={0.7}
                      />
                    );
                  })}
                  {activeBall ? (
                    <Circle
                      cx={activeBall.x}
                      cy={activeBall.y}
                      r={0.018}
                      fill="#f59e0b"
                      stroke="#fef08a"
                      strokeWidth={0.003}
                    />
                  ) : null}
                </Svg>
              </View>
            ) : null}
            {ballSpeedLabel ? (
              <View style={styles.ballSpeedBadge} pointerEvents="none">
                <Text style={styles.ballSpeedText}>Ball {ballSpeedLabel}</Text>
              </View>
            ) : null}
          </View>
        ) : activeLandmarks ? (
          <View style={[styles.videoWrap, { aspectRatio: 4 / 5 }]}>
            <View
              style={[styles.overlay, { width: "100%", height: "100%" }]}
              pointerEvents="none"
            >
              <Svg width="100%" height="100%" viewBox="0 0 1 1">
                {SKELETON_CONNECTIONS.map(([a, b], idx) => {
                  const la = activeLandmarks[a];
                  const lb = activeLandmarks[b];
                  if (!la || !lb) return null;
                  if (la.visibility < 0.3 || lb.visibility < 0.3) return null;
                  return (
                    <Line
                      key={`${idx}-${a}-${b}`}
                      x1={la.x}
                      y1={la.y}
                      x2={lb.x}
                      y2={lb.y}
                      stroke="#a3e635"
                      strokeWidth={0.004}
                      strokeOpacity={0.85}
                    />
                  );
                })}
                {activeLandmarks.map((lm, i) => {
                  if (lm.visibility < 0.3) return null;
                  return (
                    <Circle
                      key={`pt-${i}`}
                      cx={lm.x}
                      cy={lm.y}
                      r={0.012}
                      fill="#f8fafc"
                      fillOpacity={0.7}
                    />
                  );
                })}
                {activeBall ? (
                  <Circle
                    cx={activeBall.x}
                    cy={activeBall.y}
                    r={0.018}
                    fill="#f59e0b"
                    stroke="#fef08a"
                    strokeWidth={0.003}
                  />
                ) : null}
              </Svg>
            </View>
            {ballSpeedLabel ? (
              <View style={styles.ballSpeedBadge} pointerEvents="none">
                <Text style={styles.ballSpeedText}>Ball {ballSpeedLabel}</Text>
              </View>
            ) : null}
            {isDemo ? (
              <Text style={[styles.metaText, styles.demoLabel]}>
                Demo skeleton replay (no video)
              </Text>
            ) : null}
          </View>
        ) : (
          <Text style={[styles.metaText, { marginTop: 12 }]}>
            No video file is linked to this analysis for in-app replay.
          </Text>
        )}
      </SectionCard>

      <SectionCard title="Phase breakdown" subtitle="Scores per swing phase">
        {phases.length === 0 ? (
          <Text style={styles.metaText}>No phases available.</Text>
        ) : (
          phases.map((phase) => (
            <View key={`${phase.type}-${phase.startFrame}`} style={styles.phaseRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.phaseTitle}>{phase.type}</Text>
                <Text style={styles.metaText}>
                  Frames {phase.startFrame}–{phase.endFrame}
                </Text>
              </View>
              <Text style={styles.phaseScore}>{phase.score}</Text>
            </View>
          ))
        )}
      </SectionCard>

      {!isDemo && MATCH_CV_ENABLED ? (
        <SectionCard title="Match analysis" subtitle="Rallies, heatmaps, and score">
          {liveCvStatus === "pending" || liveCvStatus === "running" ? (
            <View style={styles.cvRunningRow}>
              <ActivityIndicator color="#a3e635" size="small" />
              <Text style={styles.metaText}>Match CV running on server…</Text>
            </View>
          ) : null}
          {liveCvStatus === "failed" ? (
            <Text style={styles.errorText}>Match analysis failed.</Text>
          ) : null}
          {cvActionError ? (
            <Text style={styles.errorText}>{cvActionError}</Text>
          ) : null}
          {liveCvStatus === "failed" || cvActionError ? (
            <Pressable
              onPress={() => void runMatchCv()}
              style={({ pressed }) => [
                styles.cvButton,
                pressed ? styles.buttonPressed : null,
              ]}
            >
              <Text style={styles.cvButtonText}>Retry match analysis</Text>
            </Pressable>
          ) : null}
          {cvResult?.trimmed_video_url ? (
            <Pressable
              onPress={() => setUseCondensedVideo((v) => !v)}
              style={({ pressed }) => [
                styles.condensedToggle,
                pressed ? styles.buttonPressed : null,
              ]}
            >
              <Text style={styles.metaText}>
                {useCondensedVideo ? "✓ " : ""}Condensed rally video
              </Text>
            </Pressable>
          ) : null}
          {scoring ? (
            <View style={styles.scoreBlock}>
              <Text style={styles.phaseTitle}>Match score (heuristic)</Text>
              <Text style={styles.metaText}>Side A: {scoring.score.display.side_a}</Text>
              <Text style={styles.metaText}>Side B: {scoring.score.display.side_b}</Text>
            </View>
          ) : null}
          {cvResult?.rallies?.length ? (
            cvResult.rallies.map((rally) => (
              <View key={rally.rally_id} style={styles.phaseRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.phaseTitle}>Rally {rally.rally_id}</Text>
                  <Text style={styles.metaText}>
                    {rally.start.toFixed(1)}s – {rally.end.toFixed(1)}s · max{" "}
                    {rally.max_speed.toFixed(0)} px/f
                  </Text>
                </View>
              </View>
            ))
          ) : liveCvStatus === "done" ? (
            <Text style={styles.metaText}>No rallies detected.</Text>
          ) : null}
          <MobileHeatmap players={collectHeatmapPlayers(cvResult)} />
          {cvResult?.summary ? (
            <Text style={[styles.metaText, { marginTop: 8 }]}>
              Active {cvResult.summary.total_active_sec.toFixed(1)}s · dead{" "}
              {cvResult.summary.total_dead_sec.toFixed(1)}s · shots{" "}
              {cvResult.summary.shot_count}
            </Text>
          ) : null}
        </SectionCard>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#0f172a",
  },
  content: {
    padding: 16,
    gap: 12,
  },
  centered: {
    flex: 1,
    backgroundColor: "#0f172a",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    color: "#f8fafc",
    fontSize: 18,
    fontWeight: "700",
  },
  score: {
    color: "#a3e635",
    fontSize: 28,
    fontWeight: "800",
  },
  metaText: {
    color: "#94a3b8",
    fontSize: 13,
  },
  errorText: {
    color: "#fca5a5",
    fontSize: 13,
  },
  cvRunningRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  cvButton: {
    marginTop: 8,
    borderRadius: 10,
    backgroundColor: "#a3e635",
    paddingVertical: 10,
    alignItems: "center",
  },
  cvButtonText: {
    color: "#0f172a",
    fontWeight: "700",
    fontSize: 14,
  },
  condensedToggle: {
    marginTop: 8,
    paddingVertical: 6,
  },
  scoreBlock: {
    marginTop: 8,
    gap: 4,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  badge: {
    alignSelf: "flex-start",
    backgroundColor: "#a3e63522",
    color: "#d9f99d",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: "hidden",
    fontSize: 12,
    fontWeight: "600",
  },
  phaseRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#334155",
  },
  phaseTitle: {
    color: "#f8fafc",
    fontSize: 15,
    fontWeight: "600",
    textTransform: "capitalize",
  },
  phaseScore: {
    color: "#f8fafc",
    fontSize: 22,
    fontWeight: "700",
  },
  videoWrap: {
    marginTop: 12,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#020617",
    position: "relative",
    width: "100%",
    aspectRatio: 16 / 9,
  },
  video: {
    width: "100%",
    height: "100%",
  },
  overlay: {
    position: "absolute",
    left: 0,
    top: 0,
  },
  demoLabel: {
    position: "absolute",
    bottom: 8,
    left: 8,
    backgroundColor: "#0f172acc",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  ballSpeedBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    backgroundColor: "#0f172ae6",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#f59e0b55",
  },
  ballSpeedText: {
    color: "#fde68a",
    fontSize: 12,
    fontWeight: "700",
  },
  trackingHint: {
    color: "#94a3b8",
    fontSize: 12,
    marginTop: 8,
    lineHeight: 18,
  },
});
