import { useState } from "react";
import { CheckCircle, AlertTriangle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { getMetricFeedback } from "@/lib/swingAnalyzer";
import ScoreCard from "./ScoreCard";
import type { SwingPhase, SwingPhaseType, MetricStatus } from "@shared/types";
import { PHASE_LABELS, PHASE_COLORS } from "@shared/types";

type Props = {
  phases: SwingPhase[];
  activePhase?: SwingPhaseType;
};

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

export default function MetricsPanel({ phases, activePhase }: Props) {
  const [selected, setSelected] = useState<SwingPhaseType>(
    activePhase || phases[0]?.type || "ready"
  );

  const phase = phases.find((p) => p.type === selected);
  const feedback = phase ? getMetricFeedback(phase.type, phase.metrics) : [];

  return (
    <div className="bg-padel-surface rounded-xl border border-padel-border overflow-hidden">
      {/* Phase tabs */}
      <div className="flex border-b border-padel-border overflow-x-auto">
        {phases.map((p) => (
          <button
            key={p.type}
            onClick={() => setSelected(p.type)}
            className={cn(
              "flex-1 min-w-0 px-3 py-3 text-xs font-medium whitespace-nowrap transition-colors border-b-2",
              selected === p.type
                ? "border-current text-white"
                : "border-transparent text-slate-500 hover:text-slate-300"
            )}
            style={
              selected === p.type
                ? { borderColor: PHASE_COLORS[p.type] }
                : undefined
            }
          >
            {PHASE_LABELS[p.type]}
          </button>
        ))}
      </div>

      {phase && (
        <div className="p-4">
          {/* Phase score */}
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold text-lg">
                {PHASE_LABELS[phase.type]}
              </h3>
              <p className="text-xs text-slate-500">
                Frames {phase.startFrame}–{phase.endFrame}
              </p>
            </div>
            <div className="relative">
              <ScoreCard score={phase.score} size="sm" />
            </div>
          </div>

          {/* Metric rows */}
          <div className="space-y-3">
            {feedback.map((m) => {
              const Icon = statusIcon[m.status];
              return (
                <div
                  key={m.name}
                  className="bg-slate-800/50 rounded-lg p-3"
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <Icon
                        className={cn("w-4 h-4", statusColor[m.status])}
                      />
                      <span className="text-sm font-medium">{m.name}</span>
                    </div>
                    <span className="text-sm font-mono">
                      {m.value}
                      {m.unit}
                    </span>
                  </div>

                  {/* Gauge bar */}
                  <div className="relative h-1.5 bg-slate-700 rounded-full mt-2 mb-2">
                    <div
                      className="absolute h-full rounded-full"
                      style={{
                        left: `${(m.idealRange[0] / 180) * 100}%`,
                        width: `${((m.idealRange[1] - m.idealRange[0]) / 180) * 100}%`,
                        backgroundColor: PHASE_COLORS[phase.type],
                        opacity: 0.3,
                      }}
                    />
                    <div
                      className="absolute w-2 h-2 rounded-full bg-white -top-[1px]"
                      style={{
                        left: `${Math.min(100, (m.value / 180) * 100)}%`,
                      }}
                    />
                  </div>

                  <p className="text-xs text-slate-400">{m.tip}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
