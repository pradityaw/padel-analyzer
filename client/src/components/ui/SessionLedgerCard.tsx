import { Star, Trash2 } from "lucide-react";
import { motion } from "framer-motion";
import SportPattern from "@/components/ui/SportPattern";
import { SHOT_TYPE_LABELS, type ShotType } from "@shared/types";

export type SessionLedgerCardProps = {
  title: string;
  meta: string;
  score: number;
  shotType?: ShotType | null;
  shotColor?: string;
  recordModeLabel?: string | null;
  frameCount?: number;
  isPersonalBest?: boolean;
  featured?: boolean;
  onOpen: () => void;
  onDelete?: () => void;
};

/** Vibrant flood card (featured) or white ledger row (Fixtured past-card voice). */
export default function SessionLedgerCard({
  title,
  meta,
  score,
  shotType,
  shotColor,
  recordModeLabel,
  frameCount,
  isPersonalBest,
  featured = false,
  onOpen,
  onDelete,
}: SessionLedgerCardProps) {
  if (featured && shotColor) {
    return (
      <motion.button
        type="button"
        onClick={onOpen}
        className="group relative w-full overflow-hidden rounded-2xl p-5 text-left text-ink transition-[filter] hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
        style={{ backgroundColor: shotColor }}
      >
        <SportPattern variant="mesh" />
        {isPersonalBest ? (
          <span className="absolute right-4 top-4 flex items-center gap-1 text-[10px] font-semibold text-sand">
            <Star className="h-3 w-3 fill-sand" />
            PB
          </span>
        ) : null}
        <p className="relative text-[10px] font-semibold uppercase tracking-[0.16em] text-white/70">
          {shotType ? SHOT_TYPE_LABELS[shotType] : "Session"}
        </p>
        <div className="relative mt-3 flex items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold">{title}</p>
            <p className="mt-1 text-xs text-white/70 tabular-nums">{meta}</p>
          </div>
          <p className="shrink-0 font-display-condensed text-5xl tabular-nums leading-none">
            {score}
          </p>
        </div>
        {onDelete ? (
          <button
            type="button"
            aria-label={`Delete ${title}`}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="absolute bottom-4 right-4 rounded-full p-1.5 text-white/60 opacity-0 transition-opacity hover:bg-white/10 hover:text-ink group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </motion.button>
    );
  }

  return (
    <motion.button
      type="button"
      onClick={onOpen}
      className="group relative flex w-full items-center gap-4 rounded-2xl bg-card-paper px-4 py-3.5 text-left transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-card-paper-ink">{title}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <p className="text-xs text-card-paper-muted tabular-nums">{meta}</p>
          {recordModeLabel ? (
            <span className="rounded-full border border-card-paper-ink/10 bg-card-paper-ink/5 px-1.5 py-0.5 text-[10px] font-medium text-card-paper-muted">
              {recordModeLabel}
            </span>
          ) : null}
          {shotType && shotColor ? (
            <span
              className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
              style={{
                backgroundColor: `${shotColor}18`,
                color: shotColor,
              }}
            >
              {SHOT_TYPE_LABELS[shotType]}
            </span>
          ) : null}
          {frameCount != null ? (
            <span className="text-[10px] text-card-paper-muted tabular-nums">
              {frameCount} fr
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {isPersonalBest ? (
          <Star className="h-3.5 w-3.5 fill-sand text-sand" aria-label="Personal best" />
        ) : null}
        <span
          className="font-display-condensed text-2xl tabular-nums leading-none"
          style={{ color: shotColor ?? "var(--color-card-paper-ink)" }}
        >
          {score}
        </span>
        {onDelete ? (
          <button
            type="button"
            aria-label={`Delete ${title}`}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="rounded-full p-1.5 text-card-paper-muted opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/40"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    </motion.button>
  );
}
