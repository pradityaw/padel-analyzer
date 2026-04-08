import { CheckCircle, AlertTriangle, XCircle, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MetricGap, MetricStatus } from "@shared/types";
import { PHASE_LABELS } from "@shared/types";

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

type Props = {
  metricGaps: MetricGap[];
  topInsights: string[];
};

export default function CoachingInsights({ metricGaps, topInsights }: Props) {
  const topGaps = metricGaps.filter((g) => g.status !== "good").slice(0, 3);

  return (
    <div className="space-y-6">
      {/* Top 3 coaching insights */}
      {topGaps.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-5 h-5 text-padel-green" />
            <h3 className="font-semibold text-lg">Top Improvements</h3>
          </div>
          <div className="space-y-3">
            {topGaps.map((gap, i) => {
              const Icon = statusIcon[gap.status];
              return (
                <div
                  key={`${gap.phase}-${gap.metric}`}
                  className={cn(
                    "rounded-xl border p-4",
                    statusBg[gap.status]
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">
                      <Icon
                        className={cn("w-5 h-5", statusColor[gap.status])}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-sm">
                          {gap.name} — {PHASE_LABELS[gap.phase]}
                        </span>
                        <span className="text-xs text-slate-500 font-mono">
                          #{i + 1} priority
                        </span>
                      </div>

                      {/* Value comparison */}
                      <div className="flex items-center gap-3 mb-2">
                        <span className="text-sm">
                          <span className="text-padel-green font-mono">
                            {gap.playerValue}
                            {gap.unit}
                          </span>
                          <span className="text-slate-500 mx-1">→</span>
                          <span className="text-amber-400 font-mono">
                            {gap.proValue}
                            {gap.unit}
                          </span>
                        </span>
                        <span
                          className={cn(
                            "text-xs font-mono px-1.5 py-0.5 rounded",
                            gap.delta > 0
                              ? "bg-red-500/10 text-red-400"
                              : "bg-blue-500/10 text-blue-400"
                          )}
                        >
                          {gap.delta > 0 ? "+" : ""}
                          {gap.delta}
                          {gap.unit}
                        </span>
                      </div>

                      <p className="text-sm text-slate-300">{gap.tip}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Full gap table */}
      <div>
        <h3 className="font-semibold text-sm text-slate-400 mb-3">
          All Metrics ({metricGaps.length})
        </h3>
        <div className="bg-padel-surface rounded-xl border border-padel-border overflow-hidden">
          <div className="divide-y divide-padel-border">
            {metricGaps.map((gap) => {
              const Icon = statusIcon[gap.status];
              return (
                <div
                  key={`${gap.phase}-${gap.metric}`}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm"
                >
                  <Icon
                    className={cn("w-4 h-4 shrink-0", statusColor[gap.status])}
                  />
                  <span className="text-slate-400 w-28 shrink-0 text-xs">
                    {PHASE_LABELS[gap.phase]}
                  </span>
                  <span className="font-medium w-36 shrink-0">{gap.name}</span>
                  <span className="text-padel-green font-mono w-14 text-right shrink-0">
                    {gap.playerValue}
                    {gap.unit}
                  </span>
                  <span className="text-amber-400 font-mono w-14 text-right shrink-0">
                    {gap.proValue}
                    {gap.unit}
                  </span>
                  <div className="flex-1 min-w-0">
                    {/* Importance bar */}
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
                        style={{
                          width: `${Math.min(100, gap.importance * 200)}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
