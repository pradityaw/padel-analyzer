import { CheckCircle, AlertTriangle, XCircle, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { getMetricFeedback } from "@/lib/swingAnalyzer";
import type { SwingPhase, MetricStatus, SwingPhaseType } from "@shared/types";
import { PHASE_LABELS, PHASE_COLORS } from "@shared/types";

const statusIcon: Record<MetricStatus, typeof CheckCircle> = {
  good: CheckCircle,
  improve: AlertTriangle,
  issue: XCircle,
};

const statusColor: Record<MetricStatus, string> = {
  good: "text-green-400",
  improve: "text-sand",
  issue: "text-red-400",
};

type CoachingItem = {
  phaseName: string;
  phaseType: SwingPhaseType;
  metricName: string;
  value: number;
  unit: string;
  idealRange: [number, number];
  status: MetricStatus;
  tip: string;
};

type Props = {
  phases: SwingPhase[];
};

export default function SwingCoachingPanel({ phases }: Props) {
  const items: CoachingItem[] = [];

  for (const phase of phases) {
    const feedbacks = getMetricFeedback(phase.type, phase.metrics);
    for (const f of feedbacks) {
      if (f.status !== "good") {
        items.push({
          phaseName: PHASE_LABELS[phase.type],
          phaseType: phase.type,
          metricName: f.name,
          value: f.value,
          unit: f.unit,
          idealRange: f.idealRange,
          status: f.status,
          tip: f.tip,
        });
      }
    }
  }

  // Sort: issues first, then improve; within group sort by how far from ideal
  items.sort((a, b) => {
    const rank = { issue: 0, improve: 1, good: 2 };
    return rank[a.status] - rank[b.status];
  });

  const top = items.slice(0, 4);

  if (top.length === 0) {
    return (
      <div className="bg-surface rounded-2xl border border-rule p-5 text-center">
        <CheckCircle className="w-8 h-8 text-accent mx-auto mb-2" />
        <p className="font-semibold text-accent">Great swing!</p>
        <p className="text-sm text-ink-2 mt-1">All metrics are within ideal ranges.</p>
      </div>
    );
  }

  return (
    <div className="bg-surface rounded-2xl border border-rule overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-rule">
        <TrendingUp className="w-4 h-4 text-accent" />
        <h3 className="font-semibold text-sm">Coaching Tips</h3>
        <span className="ml-auto text-xs text-muted-2">{items.length} areas to improve</span>
      </div>
      <div className="divide-y divide-rule">
        {top.map((item, i) => {
          const Icon = statusIcon[item.status];
          const phaseColor = PHASE_COLORS[item.phaseType];
          const idealMid = (item.idealRange[0] + item.idealRange[1]) / 2;
          const delta = Math.round((idealMid - item.value) * 10) / 10;

          return (
            <div key={`${item.phaseType}-${item.metricName}-${i}`} className="p-4">
              <div className="flex items-start gap-3">
                <Icon className={cn("w-4 h-4 mt-0.5 shrink-0", statusColor[item.status])} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-medium text-sm">{item.metricName}</span>
                    <span
                      className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                      style={{
                        backgroundColor: `${phaseColor}22`,
                        color: phaseColor,
                        border: `1px solid ${phaseColor}44`,
                      }}
                    >
                      {item.phaseName}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mb-1.5 text-xs">
                    <span className="font-mono tabular-nums text-ink-2">
                      {item.value}{item.unit}
                    </span>
                    <span className="text-muted-2">→</span>
                    <span className="font-mono tabular-nums text-ink-2">
                      ideal {item.idealRange[0]}–{item.idealRange[1]}{item.unit}
                    </span>
                    <span
                      className={cn(
                        "font-mono px-1 py-0.5 rounded-full text-[10px]",
                        delta > 0 ? "bg-blue-500/10 text-blue-400" : "bg-orange-500/10 text-orange-400"
                      )}
                    >
                      {delta > 0 ? "+" : ""}{delta}{item.unit}
                    </span>
                  </div>
                  <p className="text-xs text-ink-2 leading-relaxed">{item.tip}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {items.length > 4 && (
        <div className="px-4 py-2.5 border-t border-rule">
          <p className="text-xs text-muted-2 text-center">
            +{items.length - 4} more metrics in the panel →
          </p>
        </div>
      )}
    </div>
  );
}
