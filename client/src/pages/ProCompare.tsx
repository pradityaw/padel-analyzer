import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useSearch } from "wouter";
import { motion } from "framer-motion";
import {
  Trophy,
  User,
  Target,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Save,
  Download,
  BarChart2,
  AlertTriangle,
  XCircle,
  CheckCircle,
} from "lucide-react";
import * as Tabs from "@radix-ui/react-tabs";
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  ResponsiveContainer,
  Legend,
  Tooltip as RechartsTooltip,
} from "recharts";
import { trpc } from "@/lib/trpc";
import ScoreCard from "@/components/ScoreCard";
import SkeletonReplay from "@/components/SkeletonReplay";
import CoachingInsights from "@/components/CoachingInsights";
import { computeGapAnalysis } from "@/lib/gapAnalyzer";
import type {
  SwingPhase,
  FrameLandmarks,
  ShotType,
  GapAnalysis,
  SwingPhaseType,
  MetricStatus,
} from "@shared/types";
import {
  PHASE_LABELS,
  SHOT_TYPE_LABELS,
  SHOT_TYPE_COLORS,
  PHASE_COLORS,
  METRIC_LABELS,
} from "@shared/types";
import { cn } from "@/lib/utils";

const PHASE_ORDER: SwingPhaseType[] = [
  "ready",
  "backswing",
  "forwardSwing",
  "contact",
  "followThrough",
];

function RadarCompare({
  gapAnalysis,
  playerPhases,
  proPhases,
}: {
  gapAnalysis: GapAnalysis;
  playerPhases: SwingPhase[];
  proPhases: SwingPhase[];
}) {
  const [selectedPhase, setSelectedPhase] = useState<SwingPhaseType>("contact");

  const radarData = useMemo(() => {
    const player = playerPhases.find((p) => p.type === selectedPhase);
    const pro = proPhases.find((p) => p.type === selectedPhase);
    if (!player || !pro) return [];

    const keys = Object.keys(player.metrics) as (keyof typeof player.metrics)[];
    return keys.map((key) => ({
      metric: METRIC_LABELS[key]?.name ?? key,
      player: Math.round(player.metrics[key]),
      pro: Math.round(pro.metrics[key]),
    }));
  }, [selectedPhase, playerPhases, proPhases]);

  return (
    <div className="bg-padel-surface rounded-xl border border-padel-border p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BarChart2 className="w-4 h-4 text-padel-green" />
          <h3 className="font-semibold text-sm">Metrics Radar</h3>
        </div>
        {/* Phase selector */}
        <div className="flex gap-1 flex-wrap justify-end">
          {PHASE_ORDER.map((phase) => (
            <button
              key={phase}
              onClick={() => setSelectedPhase(phase)}
              className="text-[10px] px-2 py-0.5 rounded-full border transition-colors"
              style={
                selectedPhase === phase
                  ? {
                      backgroundColor: PHASE_COLORS[phase],
                      color: "#000",
                      borderColor: PHASE_COLORS[phase],
                    }
                  : {
                      borderColor: `${PHASE_COLORS[phase]}44`,
                      color: PHASE_COLORS[phase],
                      backgroundColor: `${PHASE_COLORS[phase]}11`,
                    }
              }
            >
              {PHASE_LABELS[phase]}
            </button>
          ))}
        </div>
      </div>

      {radarData.length > 0 ? (
        <ResponsiveContainer width="100%" height={260}>
          <RadarChart data={radarData} margin={{ top: 10, right: 20, bottom: 10, left: 20 }}>
            <PolarGrid stroke="#334155" />
            <PolarAngleAxis
              dataKey="metric"
              tick={{ fontSize: 10, fill: "#94a3b8" }}
            />
            <RechartsTooltip
              contentStyle={{
                background: "#0f172a",
                border: "1px solid #334155",
                borderRadius: 8,
                fontSize: 11,
              }}
            />
            <Radar
              name="You"
              dataKey="player"
              stroke="#a3e635"
              fill="#a3e635"
              fillOpacity={0.15}
              strokeWidth={2}
            />
            <Radar
              name="Pro"
              dataKey="pro"
              stroke="#f59e0b"
              fill="#f59e0b"
              fillOpacity={0.1}
              strokeWidth={2}
              strokeDasharray="4 2"
            />
            <Legend
              wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
              formatter={(value) => (
                <span style={{ color: value === "You" ? "#a3e635" : "#f59e0b" }}>
                  {value}
                </span>
              )}
            />
          </RadarChart>
        </ResponsiveContainer>
      ) : (
        <div className="h-64 flex items-center justify-center text-slate-500 text-sm">
          No data for this phase
        </div>
      )}
    </div>
  );
}

const statusIcon: Record<MetricStatus, typeof CheckCircle> = {
  good: CheckCircle,
  improve: AlertTriangle,
  issue: XCircle,
};
const statusColor: Record<MetricStatus, string> = {
  good: "text-green-400",
  improve: "text-amber-400",
  issue: "text-red-400",
};
const statusBg: Record<MetricStatus, string> = {
  good: "bg-green-400/10 border-green-400/20",
  improve: "bg-amber-400/10 border-amber-400/20",
  issue: "bg-red-400/10 border-red-400/20",
};

function GapScoreboard({ gapAnalysis }: { gapAnalysis: GapAnalysis }) {
  const top5 = [...gapAnalysis.metricGaps]
    .sort((a, b) => {
      const rank = { issue: 0, improve: 1, good: 2 };
      return rank[a.status] - rank[b.status];
    })
    .slice(0, 5);

  const focusGap = top5[0];

  return (
    <div className="bg-padel-surface rounded-xl border border-padel-border overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-padel-border">
        <Target className="w-4 h-4 text-amber-400" />
        <h3 className="font-semibold text-sm">Gap Scoreboard</h3>
        <span className="ml-auto text-xs text-slate-500">
          Top {top5.length} gaps ranked
        </span>
      </div>

      {/* Focus callout */}
      {focusGap && focusGap.status !== "good" && (
        <div
          className={cn(
            "mx-4 mt-4 rounded-lg border p-3 mb-2",
            statusBg[focusGap.status]
          )}
        >
          <p className="text-xs text-slate-400 mb-0.5">Focus Area #1</p>
          <p className="font-semibold text-sm">
            {focusGap.name} — {PHASE_LABELS[focusGap.phase]}
          </p>
          <p className="text-xs text-slate-300 mt-1">{focusGap.tip}</p>
        </div>
      )}

      <div className="divide-y divide-padel-border">
        {top5.map((gap, i) => {
          const Icon = statusIcon[gap.status];
          const absPercent = Math.min(100, Math.abs(gap.percentDelta));
          return (
            <div
              key={`${gap.phase}-${gap.metric}`}
              className="flex items-center gap-3 px-4 py-2.5"
            >
              <span className="text-xs text-slate-600 font-mono w-4 shrink-0">
                #{i + 1}
              </span>
              <Icon className={cn("w-4 h-4 shrink-0", statusColor[gap.status])} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium truncate">{gap.name}</span>
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded ml-2 shrink-0 font-mono"
                    style={{
                      color: PHASE_COLORS[gap.phase],
                      backgroundColor: `${PHASE_COLORS[gap.phase]}18`,
                    }}
                  >
                    {PHASE_LABELS[gap.phase]}
                  </span>
                </div>
                <div className="h-1.5 bg-slate-700 rounded-full">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      gap.status === "good"
                        ? "bg-green-400"
                        : gap.status === "improve"
                          ? "bg-amber-400"
                          : "bg-red-400"
                    )}
                    style={{ width: `${absPercent}%` }}
                  />
                </div>
              </div>
              <span className="text-xs font-mono text-slate-400 shrink-0 w-16 text-right">
                {gap.playerValue}{gap.unit} → {gap.proValue}{gap.unit}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ProCompare() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const initialPlayer = params.get("player");

  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(
    initialPlayer ? Number(initialPlayer) : null
  );
  const [selectedProId, setSelectedProId] = useState<number | null>(null);
  const [proMode, setProMode] = useState<"video" | "average">("video");
  const [syncFrameIdx, setSyncFrameIdx] = useState(0);
  const [syncPlaying, setSyncPlaying] = useState(false);

  // Data queries
  const { data: listData } = trpc.analysis.list.useQuery();
  const allAnalyses = listData?.items;
  const { data: proAnalyses } = trpc.proCompare.listProAnalyses.useQuery();

  const { data: playerData } = trpc.analysis.getById.useQuery(
    { id: selectedPlayerId! },
    { enabled: selectedPlayerId !== null }
  );
  const { data: proData } = trpc.analysis.getById.useQuery(
    { id: selectedProId! },
    { enabled: selectedProId !== null && proMode === "video" }
  );

  // Determine shot type from player selection
  const playerShotType = playerData?.shotType as ShotType | undefined;

  const { data: benchmark } = trpc.proCompare.getProBenchmark.useQuery(
    { shotType: playerShotType ?? "" },
    { enabled: proMode === "average" && !!playerShotType }
  );

  // Parse phase data
  const playerPhases = useMemo<SwingPhase[]>(
    () => (playerData ? JSON.parse(playerData.phasesJson) : []),
    [playerData]
  );
  const playerFrames = useMemo<FrameLandmarks[]>(
    () => (playerData ? JSON.parse(playerData.landmarksJson) : []),
    [playerData]
  );

  const proPhases = useMemo<SwingPhase[]>(() => {
    if (proMode === "video" && proData) {
      return JSON.parse(proData.phasesJson);
    }
    if (proMode === "average" && benchmark) {
      // Build synthetic phases from benchmark averages
      const phaseTypes = [
        "ready",
        "backswing",
        "forwardSwing",
        "contact",
        "followThrough",
      ] as const;
      return phaseTypes.map((type) => ({
        type,
        startFrame: 0,
        endFrame: 0,
        score: 0, // benchmark doesn't have scores, gap analyzer handles this
        metrics: benchmark.phases[type] ?? {
          shoulderRotation: 0,
          hipRotation: 0,
          elbowAngle: 0,
          kneeFlex: 0,
          spineAngle: 0,
          wristVelocity: 0,
        },
      }));
    }
    return [];
  }, [proMode, proData, benchmark]);

  const proFrames = useMemo<FrameLandmarks[]>(
    () => (proMode === "video" && proData ? JSON.parse(proData.landmarksJson) : []),
    [proMode, proData]
  );

  // Filter pro analyses to matching shot type
  const matchingProAnalyses = useMemo(() => {
    if (!proAnalyses || !playerShotType) return [];
    return proAnalyses.filter((p) => p.shotType === playerShotType);
  }, [proAnalyses, playerShotType]);

  // Compute gap analysis
  const gapAnalysis = useMemo<GapAnalysis | null>(() => {
    if (playerPhases.length === 0 || proPhases.length === 0) return null;
    return computeGapAnalysis(
      playerPhases,
      proPhases,
      playerShotType ?? "other"
    );
  }, [playerPhases, proPhases, playerShotType]);

  // Save comparison
  const saveMutation = trpc.proCompare.create.useMutation();

  const handleSave = useCallback(() => {
    if (!gapAnalysis || !selectedPlayerId) return;
    saveMutation.mutate({
      playerAnalysisId: selectedPlayerId,
      proAnalysisId: proMode === "video" ? selectedProId ?? undefined : undefined,
      shotType: gapAnalysis.shotType,
      gapAnalysisJson: JSON.stringify(gapAnalysis),
    });
  }, [gapAnalysis, selectedPlayerId, selectedProId, proMode, saveMutation]);

  // Export paired data
  const exportQuery = trpc.proCompare.exportPairedData.useQuery(undefined, {
    enabled: false,
  });
  const handleExport = async () => {
    const result = await exportQuery.refetch();
    if (result.data) {
      const blob = new Blob([JSON.stringify(result.data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `paired_training_data_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  // Sync playback for dual skeleton replay
  const maxFrames = Math.max(playerFrames.length, proFrames.length, 1);
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);

  useEffect(() => {
    if (!syncPlaying || maxFrames <= 1) return;

    const frameInterval = 1000 / 15;
    let currentFrame = syncFrameIdx;

    const animate = (timestamp: number) => {
      if (timestamp - lastTimeRef.current >= frameInterval) {
        lastTimeRef.current = timestamp;
        currentFrame = (currentFrame + 1) % maxFrames;
        setSyncFrameIdx(currentFrame);
      }
      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [syncPlaying, maxFrames]);

  const hasProSelection =
    (proMode === "video" && selectedProId !== null) ||
    (proMode === "average" && benchmark !== null);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="max-w-7xl mx-auto px-4 py-8"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <Trophy className="w-6 h-6 text-amber-400" />
          <h1 className="text-2xl font-bold">Pro Compare</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Export Pairs
          </button>
        </div>
      </div>

      {/* Selection row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {/* Player selector */}
        <div>
          <label className="flex items-center gap-2 text-sm text-padel-green mb-2">
            <User className="w-4 h-4" />
            Your Swing
          </label>
          <select
            value={selectedPlayerId ?? ""}
            onChange={(e) => {
              setSelectedPlayerId(
                e.target.value ? Number(e.target.value) : null
              );
              setSelectedProId(null); // reset pro selection on player change
            }}
            className="w-full bg-padel-surface border border-padel-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-padel-green"
          >
            <option value="">Select your analysis...</option>
            {allAnalyses?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.videoFileName} — Score: {a.overallScore}
                {a.shotType
                  ? ` (${SHOT_TYPE_LABELS[a.shotType as ShotType] ?? a.shotType})`
                  : ""}
              </option>
            ))}
          </select>
        </div>

        {/* Pro selector */}
        <div>
          <label className="flex items-center gap-2 text-sm text-amber-400 mb-2">
            <Trophy className="w-4 h-4" />
            Pro Reference
          </label>
          <Tabs.Root
            value={proMode}
            onValueChange={(v) => setProMode(v as "video" | "average")}
          >
            <Tabs.List className="flex border-b border-padel-border mb-2">
              <Tabs.Trigger
                value="video"
                className="px-3 py-1.5 text-xs font-medium border-b-2 transition-colors data-[state=active]:border-amber-400 data-[state=active]:text-amber-400 data-[state=inactive]:border-transparent data-[state=inactive]:text-slate-500"
              >
                Match with Pro Video
              </Tabs.Trigger>
              <Tabs.Trigger
                value="average"
                className="px-3 py-1.5 text-xs font-medium border-b-2 transition-colors data-[state=active]:border-amber-400 data-[state=active]:text-amber-400 data-[state=inactive]:border-transparent data-[state=inactive]:text-slate-500"
              >
                Use Pro Average
              </Tabs.Trigger>
            </Tabs.List>

            <Tabs.Content value="video">
              {matchingProAnalyses.length > 0 ? (
                <select
                  value={selectedProId ?? ""}
                  onChange={(e) =>
                    setSelectedProId(
                      e.target.value ? Number(e.target.value) : null
                    )
                  }
                  className="w-full bg-padel-surface border border-padel-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-400"
                >
                  <option value="">Select a pro reference...</option>
                  {matchingProAnalyses.map((p) => (
                    <option key={p.analysisId} value={p.analysisId}>
                      {p.videoFileName} — Score: {p.overallScore}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-sm text-slate-500 py-2">
                  {!playerShotType
                    ? "Select your swing first to see matching pro references."
                    : `No pro references for ${SHOT_TYPE_LABELS[playerShotType] ?? playerShotType} yet. Go to Annotate to label pro videos.`}
                </p>
              )}
            </Tabs.Content>

            <Tabs.Content value="average">
              {benchmark ? (
                <div className="bg-padel-surface border border-padel-border rounded-lg px-3 py-2.5 text-sm">
                  <span className="text-amber-400 font-medium">
                    {SHOT_TYPE_LABELS[playerShotType as ShotType] ??
                      playerShotType}
                  </span>
                  <span className="text-slate-400">
                    {" "}
                    — Based on {benchmark.sampleCount} pro sample
                    {benchmark.sampleCount !== 1 ? "s" : ""}
                  </span>
                </div>
              ) : (
                <p className="text-sm text-slate-500 py-2">
                  {!playerShotType
                    ? "Select your swing first."
                    : "No pro benchmarks available for this shot type."}
                </p>
              )}
            </Tabs.Content>
          </Tabs.Root>
        </div>
      </div>

      {/* Gap Analysis Results */}
      {gapAnalysis && selectedPlayerId && hasProSelection ? (
        <>
          {/* Overview scores */}
          <div className="grid grid-cols-3 gap-4 mb-8">
            <div className="bg-padel-surface rounded-xl border border-padel-border p-5 flex items-center justify-between">
              <div>
                <p className="text-xs text-padel-green font-medium mb-1">
                  Your Score
                </p>
                <p className="font-semibold">
                  {playerData?.videoFileName}
                </p>
              </div>
              <ScoreCard score={playerData?.overallScore ?? 0} size="sm" />
            </div>

            <div className="bg-padel-surface rounded-xl border border-amber-400/20 p-5 flex flex-col items-center justify-center">
              <p className="text-xs text-slate-400 mb-1">Gap Score</p>
              <div className="flex items-center gap-2">
                <Target className="w-5 h-5 text-amber-400" />
                <span className="text-3xl font-bold text-amber-400">
                  {gapAnalysis.overallGapScore}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {gapAnalysis.overallGapScore >= 80
                  ? "Very close to pro!"
                  : gapAnalysis.overallGapScore >= 60
                    ? "Good foundation"
                    : "Room to grow"}
              </p>
            </div>

            <div className="bg-padel-surface rounded-xl border border-padel-border p-5 flex items-center justify-between">
              <div>
                <p className="text-xs text-amber-400 font-medium mb-1">
                  Pro Reference
                </p>
                <p className="font-semibold">
                  {proMode === "video"
                    ? proData?.videoFileName ?? "—"
                    : `${SHOT_TYPE_LABELS[playerShotType as ShotType] ?? ""} Average`}
                </p>
              </div>
              {proMode === "video" && proData && (
                <ScoreCard score={proData.overallScore} size="sm" />
              )}
            </div>
          </div>

          {/* Synchronized skeleton replay */}
          {proMode === "video" && proFrames.length > 0 && (
            <div className="bg-padel-surface rounded-xl border border-padel-border p-5 mb-8">
              <div className="flex justify-center gap-8 mb-4">
                <SkeletonReplay
                  frames={playerFrames}
                  width={260}
                  height={340}
                  controlledFrameIdx={Math.min(
                    syncFrameIdx,
                    playerFrames.length - 1
                  )}
                  showControls={false}
                  accentColor="#a3e635"
                  label="You"
                />
                <SkeletonReplay
                  frames={proFrames}
                  width={260}
                  height={340}
                  controlledFrameIdx={Math.min(
                    syncFrameIdx,
                    proFrames.length - 1
                  )}
                  showControls={false}
                  accentColor="#f59e0b"
                  label="Pro"
                />
              </div>

              {/* Shared controls */}
              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={() => {
                    setSyncPlaying(false);
                    setSyncFrameIdx((prev) => Math.max(0, prev - 1));
                  }}
                  className="p-1.5 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
                >
                  <SkipBack className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setSyncPlaying((p) => !p)}
                  className="p-2 rounded-lg bg-padel-green/15 text-padel-green hover:bg-padel-green/25 transition-colors"
                >
                  {syncPlaying ? (
                    <Pause className="w-5 h-5" />
                  ) : (
                    <Play className="w-5 h-5" />
                  )}
                </button>
                <button
                  onClick={() => {
                    setSyncPlaying(false);
                    setSyncFrameIdx((prev) =>
                      Math.min(maxFrames - 1, prev + 1)
                    );
                  }}
                  className="p-1.5 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
                >
                  <SkipForward className="w-4 h-4" />
                </button>
                <input
                  type="range"
                  min={0}
                  max={maxFrames - 1}
                  value={syncFrameIdx}
                  onChange={(e) => {
                    setSyncPlaying(false);
                    setSyncFrameIdx(Number(e.target.value));
                  }}
                  className="w-64 accent-padel-green"
                />
                <span className="text-xs text-slate-500 tabular-nums">
                  {syncFrameIdx + 1}/{maxFrames}
                </span>
              </div>
            </div>
          )}

          {/* Phase-by-phase gap bars */}
          <h2 className="font-semibold text-lg mb-4">
            Phase-by-Phase Comparison
          </h2>
          <div className="space-y-3 mb-8">
            {gapAnalysis.phaseGaps.map((pg) => (
              <div
                key={pg.phase}
                className="bg-padel-surface rounded-xl border border-padel-border p-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-medium">{PHASE_LABELS[pg.phase]}</h3>
                  <span
                    className={`text-sm font-mono ${
                      pg.delta > 0
                        ? "text-green-400"
                        : pg.delta < 0
                          ? "text-red-400"
                          : "text-slate-400"
                    }`}
                  >
                    {pg.delta > 0 ? "+" : ""}
                    {pg.delta} pts
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-slate-800 rounded-full h-2">
                      <div
                        className="h-full rounded-full bg-padel-green"
                        style={{ width: `${pg.playerScore}%` }}
                      />
                    </div>
                    <span className="text-sm font-mono w-8 text-right text-padel-green">
                      {pg.playerScore}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-slate-800 rounded-full h-2">
                      <div
                        className="h-full rounded-full bg-amber-400"
                        style={{ width: `${pg.proScore}%` }}
                      />
                    </div>
                    <span className="text-sm font-mono w-8 text-right text-amber-400">
                      {pg.proScore}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Radar + Gap Scoreboard row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            <RadarCompare gapAnalysis={gapAnalysis} playerPhases={playerPhases} proPhases={proPhases} />
            <GapScoreboard gapAnalysis={gapAnalysis} />
          </div>

          {/* Coaching insights */}
          <CoachingInsights
            metricGaps={gapAnalysis.metricGaps}
            topInsights={gapAnalysis.topInsights}
          />

          {/* Save button */}
          <div className="mt-8 flex justify-end">
            <button
              onClick={handleSave}
              disabled={saveMutation.isPending || saveMutation.isSuccess}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold bg-padel-green text-white hover:bg-padel-green/90 transition-colors disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {saveMutation.isSuccess
                ? "Saved!"
                : saveMutation.isPending
                  ? "Saving..."
                  : "Save Comparison"}
            </button>
          </div>
        </>
      ) : (
        <div className="text-center py-16 text-slate-500">
          <Target className="w-12 h-12 mx-auto mb-4 text-slate-600" />
          <p className="text-lg mb-2">Select both swings to compare</p>
          <p className="text-sm">
            Choose your swing on the left and a pro reference on the right.
          </p>
        </div>
      )}
    </motion.div>
  );
}

