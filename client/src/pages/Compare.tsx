import { useMemo, useState } from "react";
import { useSearch, useLocation } from "wouter";
import { motion } from "framer-motion";
import { GitCompareArrows, ArrowLeft } from "lucide-react";
import { trpc } from "@/lib/trpc";
import MetricsPanel from "@/components/MetricsPanel";
import ScoreCard from "@/components/ScoreCard";
import type { SwingPhase } from "@shared/types";
import { PHASE_LABELS } from "@shared/types";

export default function Compare() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(search);
  const aId = params.get("a");
  const bId = params.get("b");

  const { data: listData } = trpc.analysis.list.useQuery();
  const analyses = listData?.items;

  const [selectedA, setSelectedA] = useState<number | null>(
    aId ? Number(aId) : null
  );
  const [selectedB, setSelectedB] = useState<number | null>(
    bId ? Number(bId) : null
  );

  const { data: dataA } = trpc.analysis.getById.useQuery(
    { id: selectedA! },
    { enabled: selectedA !== null }
  );
  const { data: dataB } = trpc.analysis.getById.useQuery(
    { id: selectedB! },
    { enabled: selectedB !== null }
  );

  const phasesA = useMemo<SwingPhase[]>(
    () => (dataA ? JSON.parse(dataA.phasesJson) : []),
    [dataA]
  );
  const phasesB = useMemo<SwingPhase[]>(
    () => (dataB ? JSON.parse(dataB.phasesJson) : []),
    [dataB]
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="max-w-7xl mx-auto px-4 py-8"
    >
      <div className="flex items-center gap-3 mb-8">
        <button
          onClick={() => navigate("/")}
          className="p-2 rounded-lg hover:bg-white/5 text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <GitCompareArrows className="w-6 h-6 text-padel-green" />
        <h1 className="text-2xl font-bold">Compare Swings</h1>
      </div>

      {/* Selectors */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {[
          { label: "Swing A", selected: selectedA, setSelected: setSelectedA },
          { label: "Swing B", selected: selectedB, setSelected: setSelectedB },
        ].map(({ label, selected, setSelected }) => (
          <div key={label}>
            <label className="text-sm text-slate-400 mb-2 block">
              {label}
            </label>
            <select
              value={selected ?? ""}
              onChange={(e) =>
                setSelected(e.target.value ? Number(e.target.value) : null)
              }
              className="w-full bg-padel-surface border border-padel-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-padel-green"
            >
              <option value="">Select an analysis...</option>
              {analyses?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.videoFileName} — Score: {a.overallScore} (
                  {new Date(a.createdAt).toLocaleDateString()})
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {/* Comparison */}
      {dataA && dataB && phasesA.length > 0 && phasesB.length > 0 ? (
        <>
          {/* Overall score comparison */}
          <div className="grid grid-cols-2 gap-6 mb-8">
            <div className="bg-padel-surface rounded-xl border border-padel-border p-5 flex items-center justify-between">
              <div>
                <p className="font-semibold">{dataA.videoFileName}</p>
                <p className="text-xs text-slate-500">
                  {new Date(dataA.createdAt).toLocaleDateString()}
                </p>
              </div>
              <div className="relative">
                <ScoreCard score={dataA.overallScore} label="Score" size="sm" />
              </div>
            </div>
            <div className="bg-padel-surface rounded-xl border border-padel-border p-5 flex items-center justify-between">
              <div>
                <p className="font-semibold">{dataB.videoFileName}</p>
                <p className="text-xs text-slate-500">
                  {new Date(dataB.createdAt).toLocaleDateString()}
                </p>
              </div>
              <div className="relative">
                <ScoreCard score={dataB.overallScore} label="Score" size="sm" />
              </div>
            </div>
          </div>

          {/* Phase-by-phase comparison */}
          <h2 className="font-semibold text-lg mb-4">Phase-by-Phase Comparison</h2>
          <div className="space-y-4">
            {phasesA.map((phaseA) => {
              const phaseB = phasesB.find((p) => p.type === phaseA.type);
              if (!phaseB) return null;
              const diff = phaseA.score - phaseB.score;
              return (
                <div
                  key={phaseA.type}
                  className="bg-padel-surface rounded-xl border border-padel-border p-4"
                >
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-medium">
                      {PHASE_LABELS[phaseA.type]}
                    </h3>
                    <span
                      className={`text-sm font-mono ${
                        diff > 0
                          ? "text-green-400"
                          : diff < 0
                            ? "text-red-400"
                            : "text-slate-400"
                      }`}
                    >
                      {diff > 0 ? "+" : ""}
                      {diff} pts
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-slate-800 rounded-full h-2">
                        <div
                          className="h-full rounded-full bg-padel-green"
                          style={{ width: `${phaseA.score}%` }}
                        />
                      </div>
                      <span className="text-sm font-mono w-8 text-right">
                        {phaseA.score}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-slate-800 rounded-full h-2">
                        <div
                          className="h-full rounded-full bg-blue-400"
                          style={{ width: `${phaseB.score}%` }}
                        />
                      </div>
                      <span className="text-sm font-mono w-8 text-right">
                        {phaseB.score}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Detailed metrics side by side */}
          <h2 className="font-semibold text-lg mt-8 mb-4">Detailed Metrics</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <MetricsPanel phases={phasesA} />
            <MetricsPanel phases={phasesB} />
          </div>
        </>
      ) : (
        <div className="text-center py-16 text-slate-500">
          <p>Select two analyses above to compare them side by side.</p>
        </div>
      )}
    </motion.div>
  );
}
