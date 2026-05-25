import type { RallyResult } from "@shared/types";

type Props = {
  rallies: RallyResult[];
  videoDurationSec: number;
  activeRallyId?: number;
  onRallyClick: (rally: RallyResult) => void;
};

export default function RallyTimeline({
  rallies,
  videoDurationSec,
  activeRallyId,
  onRallyClick,
}: Props) {
  const duration = Math.max(videoDurationSec, 1);

  if (rallies.length === 0) {
    return (
      <p className="text-sm text-slate-500 py-2">No active rallies detected in this clip.</p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative h-3 rounded-full bg-slate-800 overflow-hidden">
        {rallies.map((rally) => {
          const left = (rally.start / duration) * 100;
          const width = Math.max(0.5, ((rally.end - rally.start) / duration) * 100);
          const active = rally.rally_id === activeRallyId;
          return (
            <button
              key={rally.rally_id}
              type="button"
              title={`Rally ${rally.rally_id}: ${rally.start.toFixed(1)}s – ${rally.end.toFixed(1)}s`}
              onClick={() => onRallyClick(rally)}
              className={`absolute top-0 h-full transition-opacity ${
                active ? "opacity-100" : "opacity-70 hover:opacity-100"
              }`}
              style={{
                left: `${left}%`,
                width: `${width}%`,
                backgroundColor: active ? "#a3e635" : "#4ade80",
              }}
            />
          );
        })}
      </div>

      <ul className="space-y-2 max-h-48 overflow-y-auto pr-1">
        {rallies.map((rally) => {
          const active = rally.rally_id === activeRallyId;
          return (
            <li key={rally.rally_id}>
              <button
                type="button"
                onClick={() => onRallyClick(rally)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-left text-sm transition-colors ${
                  active
                    ? "border-padel-green/50 bg-padel-green/10 text-white"
                    : "border-padel-border text-slate-300 hover:bg-white/5"
                }`}
              >
                <span>
                  Rally {rally.rally_id} · {rally.start.toFixed(1)}s – {rally.end.toFixed(1)}s
                </span>
                <span className="text-xs text-slate-500 shrink-0">
                  {rally.max_speed.toFixed(0)} px/f
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
