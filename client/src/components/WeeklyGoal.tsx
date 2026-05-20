import { useCallback, useMemo, useState } from "react";
import { Target, Pause, Play, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "padel-weekly-goal-v1";

type GoalState = {
  targetAnalyses: number;
  paused: boolean;
  /** Monday 00:00 local time, ISO date string */
  weekStartIso: string;
};

function startOfWeekMonday(d: Date): Date {
  const copy = new Date(d);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function loadGoal(): GoalState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as GoalState;
    if (
      typeof v?.targetAnalyses !== "number" ||
      typeof v?.paused !== "boolean" ||
      typeof v?.weekStartIso !== "string"
    ) {
      return null;
    }
    return v;
  } catch {
    return null;
  }
}

function saveGoal(s: GoalState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

type Props = {
  /** ISO createdAt strings from analyses */
  analysisCreatedAts: string[];
};

export default function WeeklyGoal({ analysisCreatedAts }: Props) {
  const thisWeekStart = useMemo(() => startOfWeekMonday(new Date()), []);
  const weekStartIso = thisWeekStart.toISOString();

  const [goal, setGoal] = useState<GoalState>(() => {
    const g = loadGoal();
    if (!g) {
      return { targetAnalyses: 2, paused: false, weekStartIso };
    }
    if (g.weekStartIso !== weekStartIso) {
      const next = { ...g, weekStartIso };
      saveGoal(next);
      return next;
    }
    return g;
  });

  const persist = useCallback((next: GoalState) => {
    setGoal(next);
    saveGoal(next);
  }, []);

  const weekCount = useMemo(() => {
    const start = new Date(goal.weekStartIso).getTime();
    return analysisCreatedAts.filter((iso) => new Date(iso).getTime() >= start)
      .length;
  }, [analysisCreatedAts, goal.weekStartIso]);

  const done = goal.paused ? false : weekCount >= goal.targetAnalyses;
  const progress =
    goal.targetAnalyses > 0
      ? Math.min(1, weekCount / goal.targetAnalyses)
      : 0;

  return (
    <div className="bg-padel-surface rounded-xl border border-padel-border p-4 mb-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Target className="w-5 h-5 text-padel-green shrink-0" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-white">This week</h2>
            <p className="text-xs text-slate-500">
              Your goal — pause or change anytime. No streaks, no penalties if
              you miss it.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() =>
              persist({ ...goal, paused: !goal.paused, weekStartIso })
            }
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-padel-border text-xs text-slate-300 hover:bg-white/5"
          >
            {goal.paused ? (
              <>
                <Play className="w-3.5 h-3.5" /> Resume
              </>
            ) : (
              <>
                <Pause className="w-3.5 h-3.5" /> Pause
              </>
            )}
          </button>
          <label className="flex items-center gap-1 text-xs text-slate-400">
            <span className="sr-only">Weekly target</span>
            <ChevronDown className="w-3 h-3 opacity-60" aria-hidden />
            <select
              className="bg-slate-900 border border-padel-border rounded-lg px-2 py-1.5 text-slate-200"
              value={goal.targetAnalyses}
              onChange={(e) =>
                persist({
                  ...goal,
                  targetAnalyses: Number(e.target.value),
                  weekStartIso,
                })
              }
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n} swing{n > 1 ? "s" : ""}/week
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="mt-4">
        <div className="flex justify-between text-xs mb-1.5">
          <span className="text-slate-400">
            {goal.paused
              ? "Paused — not tracking this week"
              : `${weekCount} / ${goal.targetAnalyses} analyses this week`}
          </span>
          {!goal.paused && done ? (
            <span className="text-padel-green font-semibold">Goal met</span>
          ) : null}
        </div>
        <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500",
              goal.paused ? "bg-slate-600" : done ? "bg-padel-green" : "bg-padel-green/70"
            )}
            style={{ width: `${goal.paused ? 0 : progress * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}
