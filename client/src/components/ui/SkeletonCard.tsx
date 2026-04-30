import { cn } from "@/lib/utils";

type Props = {
  className?: string;
  lines?: number;
};

export default function SkeletonCard({ className, lines = 3 }: Props) {
  return (
    <div
      className={cn(
        "bg-padel-surface rounded-[var(--radius-card)] border border-padel-border p-[var(--space-card)] skeleton-pulse",
        className
      )}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 space-y-2">
          <div className="h-4 w-3/4 bg-padel-border/60 rounded" />
          <div className="h-3 w-1/2 bg-padel-border/40 rounded" />
        </div>
        <div className="w-14 h-14 rounded-full bg-padel-border/50 shrink-0 ml-3" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className="h-3 bg-padel-border/40 rounded"
            style={{ width: `${80 - i * 15}%` }}
          />
        ))}
      </div>
    </div>
  );
}
