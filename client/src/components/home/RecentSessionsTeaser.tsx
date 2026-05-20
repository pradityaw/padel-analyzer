import { useLocation } from "wouter";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Clock } from "lucide-react";
import { Section } from "@/components/ui/Section";
import ScoreCard from "@/components/ScoreCard";
import type { ShotType } from "@shared/types";
import { SHOT_TYPE_LABELS } from "@shared/types";

type AnalysisItem = {
  id: number;
  videoFileName: string;
  overallScore: number;
  createdAt: string;
  shotType?: string | null;
};

type Props = {
  analyses: AnalysisItem[];
};

export default function RecentSessionsTeaser({ analyses }: Props) {
  const [, navigate] = useLocation();
  const prefersReduced = useReducedMotion();
  const recent = analyses.slice(0, 3);

  if (recent.length === 0) return null;

  return (
    <Section
      label="Welcome back"
      title="Your recent sessions"
      subtitle="Pick up where you left off or analyze another swing."
      className="border-t border-padel-border"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <p className="text-sm text-slate-500">
          {analyses.length} session{analyses.length === 1 ? "" : "s"} saved
        </p>
        <button
          type="button"
          onClick={() => navigate("/sessions")}
          className="inline-flex items-center gap-1.5 text-sm text-padel-green hover:underline focus-ring rounded"
        >
          View all sessions
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1 snap-x snap-mandatory">
        {recent.map((a, i) => (
          <motion.button
            key={a.id}
            type="button"
            initial={{ opacity: 0, x: prefersReduced ? 0 : 16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: prefersReduced ? 0 : i * 0.08 }}
            onClick={() => navigate(`/analysis/${a.id}`)}
            className="snap-start shrink-0 w-[min(100%,280px)] text-left rounded-xl border border-padel-border bg-padel-surface p-4 hover:border-padel-green/40 hover:bg-padel-green/5 transition-colors focus-ring"
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="min-w-0">
                <p className="font-medium text-sm truncate">{a.videoFileName}</p>
                <p className="text-xs text-slate-500 flex items-center gap-1 mt-1">
                  <Clock className="w-3 h-3" />
                  {new Date(a.createdAt).toLocaleDateString()}
                </p>
              </div>
              <ScoreCard score={a.overallScore} size="sm" />
            </div>
            {a.shotType ? (
              <span className="text-xs text-slate-400">
                {SHOT_TYPE_LABELS[a.shotType as ShotType] ?? a.shotType}
              </span>
            ) : null}
          </motion.button>
        ))}
      </div>
    </Section>
  );
}
