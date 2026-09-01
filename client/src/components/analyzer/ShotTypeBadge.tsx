import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { trpc } from "@/lib/trpc";
import {
  SHOT_TYPES,
  SHOT_TYPE_LABELS,
  SHOT_TYPE_COLORS,
  type ShotType,
} from "@shared/types";

export function ShotTypeBadge({
  shotType,
  confidence,
  analysisId,
}: {
  shotType: string | null;
  confidence: number | null;
  analysisId: number;
}) {
  const [open, setOpen] = useState(false);
  const utils = trpc.useUtils();
  const createAnnotation = trpc.annotation.create.useMutation({
    onSuccess: () => {
      utils.analysis.getById.invalidate({ id: analysisId });
      utils.annotation.stats.invalidate();
      setOpen(false);
    },
  });

  const color = shotType
    ? SHOT_TYPE_COLORS[shotType as ShotType] ?? "#6b75a3"
    : "#6b75a3";
  const label = shotType
    ? SHOT_TYPE_LABELS[shotType as ShotType] ?? shotType
    : "Unclassified";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-rule hover:border-muted-2 transition-colors text-sm"
      >
        <span
          className="w-2.5 h-2.5 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span>{label}</span>
        {confidence != null && (
          <span className="text-muted-2 text-xs tabular-nums">
            {Math.round(confidence * 100)}%
          </span>
        )}
        <ChevronDown className="w-3.5 h-3.5 text-muted-2" />
      </button>

      {open && (
        <div className="absolute top-full mt-1 right-0 z-20 bg-surface border border-rule rounded-xl shadow-xl p-1 min-w-[140px]">
          {SHOT_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => {
                createAnnotation.mutate({
                  analysisId,
                  shotType: type,
                  isProReference: false,
                });
              }}
              className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm text-left hover:bg-white/5 transition-colors ${
                type === shotType ? "text-accent" : "text-ink-2"
              }`}
            >
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: SHOT_TYPE_COLORS[type] }}
              />
              {SHOT_TYPE_LABELS[type]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
