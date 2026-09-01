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
  improve: "text-sand",
  issue: "text-red-400",
};

const statusBg: Record<MetricStatus, string> = {
  good: "bg-green-400/10 border-green-400/20",
  improve: "bg-sand/10 border-sand/20",
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
            <TrendingUp className="w-5 h-5 text-accent" />
            <h3 className="font-semibold text-lg">Top Improvements</h3>
          </div>
          <div className="space-y-3">
            {topGaps.map((gap, i) => {
              const Icon = statusIcon[gap.status];
              return (
                <div
                  key={`${gap.phase}-${gap.metric}`}
                  className={cn(
                    "rounded-2xl border p-4",
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
                        <span className="text-xs text-muted-2 font-mono">
                          #{i + 1} priority
                        </span>
                      </div>

                      {/* Value comparison */}
                      <div className="flex items-center gap-3 mb-2">
                        <span className="text-sm">
                          <span className="text-ink font-mono tabular-nums">
                            {gap.playerValue}
                            {gap.unit}
                          </span>
                          <span className="text-muted-2 mx-1">→</span>
                          <span className="text-sand font-mono tabular-nums">
                            {gap.proValue}
                            {gap.unit}
                          </span>
                        </span>
                        <span
                          className={cn(
                            "text-xs font-mono px-1.5 py-0.5 rounded-full",
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

                      <p className="text-sm text-ink-2">{gap.tip}</p>
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
        <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-2 mb-3">
          All Metrics ({metricGaps.length})
        </h3>
        <div className="bg-surface rounded-2xl border border-rule overflow-hidden">
          <div className="divide-y divide-rule">
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
                  <span className="text-ink-2 w-28 shrink-0 text-xs">
                    {PHASE_LABELS[gap.phase]}
                  </span>
                  <span className="font-medium w-36 shrink-0">{gap.name}</span>
                  <span className="text-ink font-mono tabular-nums w-14 text-right shrink-0">
                    {gap.playerValue}
                    {gap.unit}
                  </span>
                  <span className="text-sand font-mono tabular-nums w-14 text-right shrink-0">
                    {gap.proValue}
                    {gap.unit}
                  </span>
                  <div className="flex-1 min-w-0">
                    {/* Importance bar */}
                    <div className="h-1.5 bg-rule rounded-full">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          gap.status === "good"
                            ? "bg-green-400"
                            : gap.status === "improve"
                              ? "bg-sand"
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
