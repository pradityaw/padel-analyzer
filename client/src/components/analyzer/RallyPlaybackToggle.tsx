import { Film, Scissors } from "lucide-react";

/**
 * Compact toggle between full source video and "Only Rallies" highlight playback.
 */
export function RallyPlaybackToggle({
  onlyRallies,
  onChange,
  rallyCount,
  totalActiveMs,
  videoDurationMs,
  inFlight,
  failed,
  audioAvailable,
}: {
  onlyRallies: boolean;
  onChange: (next: boolean) => void;
  rallyCount: number;
  totalActiveMs: number;
  videoDurationMs: number;
  inFlight: boolean;
  failed: boolean;
  audioAvailable: boolean;
}) {
  if (failed) return null;
  if (!inFlight && rallyCount === 0) return null;

  const trimRatio =
    videoDurationMs > 0
      ? Math.max(0, Math.min(1, 1 - totalActiveMs / videoDurationMs))
      : 0;

  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-2xl bg-surface border border-rule">
      <div className="flex flex-col">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink">
          {onlyRallies ? (
            <Scissors className="w-4 h-4 text-accent" />
          ) : (
            <Film className="w-4 h-4 text-ink-2" />
          )}
          Playback mode
        </div>
        <div className="text-xs text-muted-2 tabular-nums">
          {inFlight ? (
            "Detecting rally windows…"
          ) : (
            <>
              {rallyCount} rallies · {(totalActiveMs / 1000).toFixed(1)}s active
              {videoDurationMs > 0
                ? ` · saves ${Math.round(trimRatio * 100)}%`
                : ""}
              {audioAvailable ? " · audio-aware" : ""}
            </>
          )}
        </div>
      </div>
      <div
        role="tablist"
        aria-label="Video playback mode"
        className="inline-flex rounded-full border border-rule bg-raised p-0.5"
      >
        <button
          type="button"
          role="tab"
          aria-selected={!onlyRallies}
          disabled={inFlight}
          onClick={() => onChange(false)}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
            !onlyRallies
              ? "bg-white/15 text-ink"
              : "text-ink-2 hover:text-ink"
          }`}
        >
          Full Video
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={onlyRallies}
          disabled={inFlight || rallyCount === 0}
          onClick={() => onChange(true)}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
            onlyRallies
              ? "bg-accent text-cta-ink"
              : "text-ink-2 hover:text-ink"
          } ${rallyCount === 0 ? "opacity-40 cursor-not-allowed" : ""}`}
        >
          Only Rallies
        </button>
      </div>
    </div>
  );
}
