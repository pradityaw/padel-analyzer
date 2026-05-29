import { useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import {
  Clock,
  Trash2,
  Activity,
  Plus,
  Star,
  Target,
  Layers,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { trpc } from "@/lib/trpc";
import ScoreCard from "@/components/ScoreCard";
import type { ShotType } from "@shared/types";
import { SHOT_TYPE_LABELS, SHOT_TYPE_COLORS } from "@shared/types";

export default function History() {
  const [, navigate] = useLocation();
  const [shotFilter, setShotFilter] = useState<ShotType | "all">("all");
  const utils = trpc.useUtils();
  const { data: listData, isLoading } = trpc.analysis.list.useQuery();
  const analyses = listData?.items;
  const deleteMutation = trpc.analysis.delete.useMutation({
    onSuccess: () => utils.analysis.list.invalidate(),
  });

  const bestScore = analyses
    ? Math.max(0, ...analyses.map((a) => a.overallScore))
    : 0;

  const shotTypeCounts = analyses
    ? analyses.reduce<Partial<Record<ShotType, number>>>((acc, a) => {
        if (a.shotType) {
          acc[a.shotType as ShotType] = (acc[a.shotType as ShotType] ?? 0) + 1;
        }
        return acc;
      }, {})
    : {};

  const topShotType = Object.entries(shotTypeCounts).sort(
    ([, a], [, b]) => b - a
  )[0]?.[0] as ShotType | undefined;

  const presentShotTypes = Object.keys(shotTypeCounts) as ShotType[];

  const filteredAnalyses =
    shotFilter === "all"
      ? analyses
      : analyses?.filter((a) => a.shotType === shotFilter);

  const chartData = analyses
    ?.slice()
    .reverse()
    .map((a) => ({
      date: new Date(a.createdAt).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
      }),
      score: a.overallScore,
    }));

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="w-8 h-8 border-2 border-padel-green border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="max-w-5xl mx-auto px-4 py-8"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3 min-w-0">
          <Clock className="w-6 h-6 text-padel-green shrink-0" />
          <h1 className="display text-3xl sm:text-4xl truncate">Sessions</h1>
        </div>
        <button
          type="button"
          onClick={() => navigate("/upload")}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-padel-green text-black text-sm font-bold hover:opacity-90 transition-opacity shrink-0"
        >
          <Plus className="w-4 h-4" />
          New analysis
        </button>
      </div>

      {!analyses || analyses.length === 0 ? (
        <div className="text-center py-16">
          <Activity className="w-12 h-12 text-slate-600 mx-auto mb-4" />
          <p className="text-slate-400 text-lg mb-2">No analyses yet</p>
          <p className="text-sm text-slate-500 mb-6">
            Upload a video to get started
          </p>
          <button
            onClick={() => navigate("/upload")}
            className="px-5 py-2.5 rounded-lg bg-padel-green text-black font-bold hover:opacity-90 transition-opacity"
          >
            Analyze a Swing
          </button>
        </div>
      ) : (
        <>
          {/* Hero stat bar */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            {[
              {
                icon: Layers,
                label: "Sessions",
                value: analyses.length,
                color: "text-padel-green",
              },
              {
                icon: Star,
                label: "Personal Best",
                value: bestScore,
                color: "text-amber-400",
              },
              {
                icon: Target,
                label: "Top Shot",
                value: topShotType
                  ? SHOT_TYPE_LABELS[topShotType]
                  : "—",
                color: topShotType
                  ? undefined
                  : "text-slate-400",
                style: topShotType
                  ? { color: SHOT_TYPE_COLORS[topShotType] }
                  : undefined,
              },
            ].map(({ icon: Icon, label, value, color, style }) => (
              <div
                key={label}
                className="bg-padel-surface rounded-xl border border-padel-border px-4 py-3 flex items-center gap-3"
              >
                <Icon className={`w-5 h-5 shrink-0 ${color ?? ""}`} style={style} />
                <div className="min-w-0">
                  <p className="text-xs text-slate-500 truncate">{label}</p>
                  <p
                    className={`font-bold text-lg leading-tight truncate ${color ?? ""}`}
                    style={style}
                  >
                    {value}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Progress chart */}
          {chartData && chartData.length > 1 && (
            <div className="bg-padel-surface rounded-xl border border-padel-border p-5 mb-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-slate-400">Score Progress</h2>
                {bestScore > 0 && (
                  <span className="text-xs text-amber-400 flex items-center gap-1">
                    <Star className="w-3 h-3" />
                    PB: {bestScore}
                  </span>
                )}
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: "#64748b" }}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fontSize: 11, fill: "#64748b" }}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#0f172a",
                      border: "1px solid #334155",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  {bestScore > 0 && (
                    <ReferenceLine
                      y={bestScore}
                      stroke="#f59e0b"
                      strokeDasharray="4 4"
                      strokeWidth={1.5}
                      label={{
                        value: `PB ${bestScore}`,
                        fill: "#f59e0b",
                        fontSize: 10,
                        position: "insideTopRight",
                      }}
                    />
                  )}
                  <Line
                    type="monotone"
                    dataKey="score"
                    stroke="#a3e635"
                    strokeWidth={2}
                    dot={{ fill: "#a3e635", r: 4 }}
                    activeDot={{ r: 6, fill: "#a3e635", stroke: "#0f172a", strokeWidth: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Shot-type filter pills */}
          {presentShotTypes.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap mb-4">
              <button
                onClick={() => setShotFilter("all")}
                className={[
                  "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                  shotFilter === "all"
                    ? "bg-padel-green text-black border-padel-green"
                    : "border-padel-border text-slate-400 hover:border-slate-500 hover:text-white",
                ].join(" ")}
              >
                All ({analyses.length})
              </button>
              {presentShotTypes.map((type) => (
                <button
                  key={type}
                  onClick={() =>
                    setShotFilter((prev) => (prev === type ? "all" : type))
                  }
                  className="px-3 py-1 rounded-full text-xs font-medium border transition-all"
                  style={
                    shotFilter === type
                      ? {
                          backgroundColor: SHOT_TYPE_COLORS[type],
                          color: "#000",
                          borderColor: SHOT_TYPE_COLORS[type],
                        }
                      : {
                          borderColor: `${SHOT_TYPE_COLORS[type]}44`,
                          color: SHOT_TYPE_COLORS[type],
                          backgroundColor: `${SHOT_TYPE_COLORS[type]}10`,
                        }
                  }
                >
                  {SHOT_TYPE_LABELS[type]} ({shotTypeCounts[type]})
                </button>
              ))}
            </div>
          )}

          {/* Analysis cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {(filteredAnalyses ?? []).map((a) => {
              const isPB = a.overallScore === bestScore && bestScore > 0;
              const shotColor = a.shotType
                ? SHOT_TYPE_COLORS[a.shotType as ShotType]
                : undefined;
              return (
                <motion.div
                  key={a.id}
                  whileHover={{ scale: 1.02 }}
                  className="bg-padel-surface rounded-xl border border-padel-border p-4 cursor-pointer group relative overflow-hidden"
                  style={
                    shotColor
                      ? { borderLeftColor: shotColor, borderLeftWidth: 3 }
                      : undefined
                  }
                  onClick={() => navigate(`/analysis/${a.id}`)}
                >
                  {isPB && (
                    <div className="absolute top-2.5 right-2.5 flex items-center gap-1 text-[10px] text-amber-400 font-semibold">
                      <Star className="w-3 h-3 fill-amber-400" />
                      PB
                    </div>
                  )}

                  <div className="flex items-start justify-between mb-3 pr-8">
                    <div className="min-w-0">
                      <p className="font-medium truncate text-sm">{a.videoFileName}</p>
                      <p className="text-xs text-slate-500">
                        {new Date(a.createdAt).toLocaleDateString()} —{" "}
                        {a.dominantSide === "right" ? "R" : "L"}-hand
                      </p>
                    </div>
                    <ScoreCard score={a.overallScore} size="sm" />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      {a.shotType && (
                        <span
                          className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                          style={{
                            backgroundColor: `${shotColor}22`,
                            color: shotColor,
                            border: `1px solid ${shotColor}44`,
                          }}
                        >
                          {SHOT_TYPE_LABELS[a.shotType as ShotType]}
                        </span>
                      )}
                      <span className="text-xs text-slate-500">
                        {a.frameCount} fr
                      </span>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm("Delete this analysis?")) {
                          deleteMutation.mutate({ id: a.id });
                        }
                      }}
                      className="p-1.5 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-400/10 transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </>
      )}
    </motion.div>
  );
}
