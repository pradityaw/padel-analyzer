import type { RallyResult } from "@shared/types";
import { UI } from "@/lib/uiColors";

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
      <p className="text-sm text-muted-2 py-2">No active rallies detected in this clip.</p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative h-3 rounded-full bg-raised overflow-hidden">
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
                active ? "opacity-100" : "opacity-60 hover:opacity-100"
              }`}
              style={{
                left: `${left}%`,
                width: `${width}%`,
                backgroundColor: UI.accent,
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
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-full border text-left text-sm transition-colors ${
                  active
                    ? "border-accent/50 bg-accent/10 text-ink"
                    : "border-rule text-ink-2 hover:bg-white/5"
                }`}
              >
                <span>
                  Rally {rally.rally_id} · {rally.start.toFixed(1)}s – {rally.end.toFixed(1)}s
                </span>
                <span className="text-xs text-muted-2 shrink-0 tabular-nums">
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
