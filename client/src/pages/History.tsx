/* Hallmark · genre: modern-minimal (dark, data-led sports) · macrostructure: Stat-Led
 * design-system: design.md · designed-as-app · theme: studied-DNA "Court Flood" (source: image)
 * pre-emit critique: P5 H5 E5 S5 R4 V4 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { AnimatePresence, motion } from "framer-motion";
import { Activity, Plus, Star } from "lucide-react";
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
import { DEMO_ANALYSIS_ID } from "@/lib/sampleAnalysis";
import SessionLedgerCard from "@/components/ui/SessionLedgerCard";
import type { RecordMode, ShotType } from "@shared/types";
import {
  RECORD_MODE_LABELS,
  SHOT_TYPE_LABELS,
  SHOT_TYPE_COLORS,
} from "@shared/types";

function recordModeLabel(mode: string | null | undefined): string | null {
  if (!mode || !(mode in RECORD_MODE_LABELS)) return null;
  return RECORD_MODE_LABELS[mode as RecordMode];
}

type AnalysisListItem = { id: number; videoFileName: string };

const UNDO_WINDOW_MS = 5000;

function formatSessionMeta(a: {
  createdAt: string;
  dominantSide: string;
  durationMs?: number | null;
  frameCount: number;
}): string {
  const date = new Date(a.createdAt).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const dur =
    a.durationMs != null
      ? `${Math.round(a.durationMs / 1000)}s`
      : `${a.frameCount} fr`;
  const hand = a.dominantSide === "right" ? "R" : "L";
  return `${date} · ${dur} · ${hand}-hand`;
}

function groupAnalysesByDay<T extends { createdAt: string }>(
  items: T[]
): { key: string; label: string; dayNum: string; items: T[] }[] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const d = new Date(item.createdAt);
    const key = d.toDateString();
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  return [...map.entries()].map(([key, dayItems]) => {
    const d = new Date(key);
    return {
      key,
      label: d.toLocaleDateString("en-GB", { weekday: "short" }).toUpperCase(),
      dayNum: String(d.getDate()),
      items: dayItems,
    };
  });
}

export default function History() {
  const [, navigate] = useLocation();
  const [shotFilter, setShotFilter] = useState<ShotType | "all">("all");
  const utils = trpc.useUtils();
  const { data: listData, isLoading } = trpc.analysis.list.useQuery();
  const analyses = listData?.items;
  const deleteMutation = trpc.analysis.delete.useMutation({
    onSuccess: () => utils.analysis.list.invalidate(),
  });

  // Optimistic delete with an undo window. The actual server mutation only
  // fires once the window elapses, so Undo is a true cancel (no surprise write).
  const [pendingDelete, setPendingDelete] = useState<{
    item: AnalysisListItem;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const pendingRef = useRef<typeof pendingDelete>(null);
  pendingRef.current = pendingDelete;

  const commitDelete = useCallback(
    (id: number) => {
      deleteMutation.mutate({ id });
    },
    [deleteMutation]
  );

  const handleDelete = useCallback(
    (item: AnalysisListItem) => {
      // Flush any in-flight pending delete before starting a new one.
      if (pendingRef.current) {
        clearTimeout(pendingRef.current.timer);
        commitDelete(pendingRef.current.item.id);
      }
      utils.analysis.list.setData(undefined, (old) =>
        old
          ? { ...old, items: old.items.filter((a) => a.id !== item.id) }
          : old
      );
      const timer = setTimeout(() => {
        commitDelete(item.id);
        setPendingDelete(null);
      }, UNDO_WINDOW_MS);
      setPendingDelete({ item, timer });
    },
    [commitDelete, utils.analysis.list]
  );

  const handleUndo = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    setPendingDelete(null);
    void utils.analysis.list.invalidate();
  }, [utils.analysis.list]);

  // On unmount, commit any pending delete so it is not silently dropped.
  useEffect(() => {
    return () => {
      const pending = pendingRef.current;
      if (pending) {
        clearTimeout(pending.timer);
        commitDelete(pending.item.id);
      }
    };
  }, [commitDelete]);

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

  const dayGroups = groupAnalysesByDay(filteredAnalyses ?? []);

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
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
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
      <div className="mb-6 flex items-end justify-between gap-4">
        <h1 className="font-display-condensed text-3xl text-ink sm:text-4xl">
          Your sports schedule
        </h1>
        <button
          type="button"
          onClick={() => navigate("/app/upload")}
          className="flex shrink-0 items-center gap-2 rounded-full bg-cta px-5 py-2 text-sm font-bold text-cta-ink transition-colors hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <Plus className="h-4 w-4" />
          New
        </button>
      </div>

      {!analyses || analyses.length === 0 ? (
        <div className="mx-auto max-w-md rounded-2xl bg-flood px-6 py-12 text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-white/10">
            <Activity className="h-7 w-7 text-ink" />
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/70">
            No sessions yet
          </p>
          <h2 className="mt-2 font-display-condensed text-2xl text-ink">
            Analyze your first swing
          </h2>
          <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-white/70">
            Upload a side-view clip or paste a YouTube link. Your scores and
            progress will land here.
          </p>
          <button
            type="button"
            onClick={() => navigate("/app/upload")}
            className="mt-6 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-cta px-5 font-bold text-cta-ink transition-colors hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <Plus className="h-4 w-4" />
            Analyze a swing
          </button>
          <button
            type="button"
            onClick={() => navigate(`/app/analysis/${DEMO_ANALYSIS_ID}`)}
            className="mt-3 text-sm font-medium text-white/70 underline-offset-4 transition-colors hover:text-ink hover:underline"
          >
            Preview the demo dashboard
          </button>
        </div>
      ) : (
        <>
          {/* Hero stat bar */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            {[
              {
                label: "Sessions",
                value: analyses.length,
                color: "text-ink",
              },
              {
                label: "Personal Best",
                value: bestScore,
                color: "text-sand",
              },
              {
                label: "Top Shot",
                value: topShotType ? SHOT_TYPE_LABELS[topShotType] : "—",
                color: topShotType ? undefined : "text-ink-2",
                style: topShotType
                  ? { color: SHOT_TYPE_COLORS[topShotType] }
                  : undefined,
              },
            ].map(({ label, value, color, style }) => (
              <div
                key={label}
                className="flex flex-col gap-2 rounded-2xl border border-rule bg-surface px-4 py-3.5"
              >
                <span className="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-2">
                  {label}
                </span>
                <p
                  className={`truncate text-xl font-bold leading-none tabular-nums sm:text-2xl ${color ?? "text-ink"}`}
                  style={style}
                >
                  {value}
                </p>
              </div>
            ))}
          </div>

          {/* Progress chart */}
          {chartData && chartData.length > 1 && (
            <div className="bg-surface rounded-2xl border border-rule p-5 mb-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-2">
                  Score Progress
                </h2>
                {bestScore > 0 && (
                  <span className="text-xs text-sand flex items-center gap-1 tabular-nums">
                    <Star className="w-3 h-3" />
                    PB: {bestScore}
                  </span>
                )}
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#28315e" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: "#6b75a3" }}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fontSize: 11, fill: "#6b75a3" }}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#131a40",
                      border: "1px solid #28315e",
                      borderRadius: 12,
                      fontSize: 12,
                    }}
                  />
                  {bestScore > 0 && (
                    <ReferenceLine
                      y={bestScore}
                      stroke="#e8c468"
                      strokeDasharray="4 4"
                      strokeWidth={1.5}
                      label={{
                        value: `PB ${bestScore}`,
                        fill: "#e8c468",
                        fontSize: 10,
                        position: "insideTopRight",
                      }}
                    />
                  )}
                  <Line
                    type="monotone"
                    dataKey="score"
                    stroke="#5b8cff"
                    strokeWidth={2}
                    dot={{ fill: "#5b8cff", r: 4 }}
                    activeDot={{ r: 6, fill: "#5b8cff", stroke: "#0a0f2e", strokeWidth: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Shot-type filter — horizontal scroll circles (Fixtured team-strip voice) */}
          {presentShotTypes.length > 0 && (
            <div className="mb-6 flex gap-3 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <button
                type="button"
                onClick={() => setShotFilter("all")}
                className={[
                  "flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-full border-2 text-[10px] font-bold uppercase transition-colors",
                  shotFilter === "all"
                    ? "border-cta bg-cta text-cta-ink"
                    : "border-rule bg-surface text-ink-2 hover:border-accent/40",
                ].join(" ")}
              >
                All
              </button>
              {presentShotTypes.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() =>
                    setShotFilter((prev) => (prev === type ? "all" : type))
                  }
                  className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-full border-2 text-[9px] font-bold uppercase leading-tight transition-all"
                  style={
                    shotFilter === type
                      ? {
                          backgroundColor: SHOT_TYPE_COLORS[type],
                          borderColor: SHOT_TYPE_COLORS[type],
                          color: "#0a0f2e",
                        }
                      : {
                          borderColor: `${SHOT_TYPE_COLORS[type]}55`,
                          color: SHOT_TYPE_COLORS[type],
                          backgroundColor: `${SHOT_TYPE_COLORS[type]}12`,
                        }
                  }
                >
                  {SHOT_TYPE_LABELS[type].slice(0, 6)}
                </button>
              ))}
            </div>
          )}

          {/* Timeline ledger — date rail + flood featured + white rows */}
          <div className="space-y-8">
            {dayGroups.map((group, groupIdx) => (
              <div key={group.key} className="flex gap-4">
                <div className="flex w-10 shrink-0 flex-col items-center pt-1">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-2">
                    {group.label}
                  </span>
                  <span className="font-display-condensed text-2xl tabular-nums text-ink">
                    {group.dayNum}
                  </span>
                  <span
                    aria-hidden
                    className={`mt-2 w-px flex-1 min-h-[2rem] ${
                      groupIdx === dayGroups.length - 1 ? "bg-transparent" : "bg-rule"
                    }`}
                  />
                </div>
                <div className="min-w-0 flex-1 space-y-3 pb-2">
                  {group.items.map((a, idx) => {
                    const isFirstOverall =
                      groupIdx === 0 &&
                      idx === 0 &&
                      shotFilter === "all";
                    const isPB = a.overallScore === bestScore && bestScore > 0;
                    const shotType = a.shotType as ShotType | null | undefined;
                    const shotColor = shotType
                      ? SHOT_TYPE_COLORS[shotType]
                      : undefined;
                    return (
                      <SessionLedgerCard
                        key={a.id}
                        title={a.videoFileName}
                        meta={formatSessionMeta(a)}
                        score={a.overallScore}
                        shotType={shotType}
                        shotColor={shotColor}
                        recordModeLabel={recordModeLabel(a.mode)}
                        frameCount={a.frameCount}
                        isPersonalBest={isPB}
                        featured={isFirstOverall && !!shotColor}
                        onOpen={() => navigate(`/app/analysis/${a.id}`)}
                        onDelete={() =>
                          handleDelete({
                            id: a.id,
                            videoFileName: a.videoFileName,
                          })
                        }
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <AnimatePresence>
        {pendingDelete && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            role="status"
            className="fixed inset-x-0 bottom-6 z-50 mx-auto flex w-fit max-w-[calc(100vw-2rem)] items-center gap-4 rounded-full border border-rule bg-surface/95 py-2.5 pl-5 pr-2.5 shadow-2xl backdrop-blur-lg"
          >
            <span className="truncate text-sm text-ink-2">
              Deleted{" "}
              <span className="font-medium text-ink">
                {pendingDelete.item.videoFileName}
              </span>
            </span>
            <button
              type="button"
              onClick={handleUndo}
              className="shrink-0 rounded-full bg-cta px-4 py-1.5 text-sm font-bold text-cta-ink transition-colors hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              Undo
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
