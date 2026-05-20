import { useEffect, useMemo, useRef, useState } from "react";
import type { HeatmapPlayer } from "@shared/types";

type Props = {
  players: HeatmapPlayer[];
  courtWidthM?: number;
  courtHeightM?: number;
};

const DEFAULT_COLORS = ["#FF6B6B", "#4ECDC4", "#45B7D1", "#FFA94D"];

function heatColor(value: number, baseRgb: [number, number, number]): string {
  const alpha = Math.min(1, Math.max(0, value));
  const [r, g, b] = baseRgb;
  return `rgba(${r}, ${g}, ${b}, ${0.15 + alpha * 0.85})`;
}

function parseHex(hex: string): [number, number, number] {
  const normalized = hex.replace("#", "");
  if (normalized.length !== 6) return [163, 230, 53];
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return [r, g, b];
}

export default function CourtHeatmapOverlay({
  players,
  courtWidthM = 10,
  courtHeightM = 20,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visibleIds, setVisibleIds] = useState<Set<number>>(() => new Set());

  const withHeatmaps = useMemo(
    () => players.filter((p) => (p.heatmap?.length ?? 0) > 0),
    [players]
  );

  useEffect(() => {
    setVisibleIds(new Set(withHeatmaps.map((p) => p.player_id)));
  }, [withHeatmaps]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "#334155";
    ctx.lineWidth = 2;
    ctx.strokeRect(8, 8, width - 16, height - 16);
    ctx.beginPath();
    ctx.moveTo(8, height / 2);
    ctx.lineTo(width - 8, height / 2);
    ctx.stroke();

    for (const player of withHeatmaps) {
      if (!visibleIds.has(player.player_id)) continue;
      const cells = player.heatmap ?? [];
      if (cells.length === 0) continue;
      const rows = cells.length;
      const cols = cells[0]?.length ?? 1;
      const cellW = (width - 16) / cols;
      const cellH = (height - 16) / rows;
      const rgb = parseHex(
        player.color_hint ?? DEFAULT_COLORS[(player.player_id - 1) % DEFAULT_COLORS.length]!
      );

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const value = cells[row]?.[col] ?? 0;
          if (value <= 0) continue;
          ctx.fillStyle = heatColor(value, rgb);
          ctx.fillRect(8 + col * cellW, 8 + row * cellH, cellW, cellH);
        }
      }
    }
  }, [withHeatmaps, visibleIds, courtWidthM, courtHeightM]);

  if (withHeatmaps.length === 0) {
    return (
      <p className="text-sm text-slate-500">No player heatmap data for this match.</p>
    );
  }

  return (
    <div className="space-y-3">
      <canvas
        ref={canvasRef}
        width={320}
        height={640}
        className="w-full max-w-xs mx-auto rounded-lg border border-padel-border bg-slate-900"
        aria-label={`Court heatmap ${courtWidthM}m by ${courtHeightM}m`}
      />
      <div className="flex flex-wrap gap-2">
        {withHeatmaps.map((player) => {
          const on = visibleIds.has(player.player_id);
          const color =
            player.color_hint ??
            DEFAULT_COLORS[(player.player_id - 1) % DEFAULT_COLORS.length];
          return (
            <button
              key={player.player_id}
              type="button"
              onClick={() => {
                setVisibleIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(player.player_id)) next.delete(player.player_id);
                  else next.add(player.player_id);
                  return next;
                });
              }}
              className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                on ? "text-white" : "text-slate-500 opacity-60"
              }`}
              style={{
                borderColor: color,
                backgroundColor: on ? `${color}33` : "transparent",
              }}
            >
              Player {player.player_id}
              {player.distance_m != null
                ? ` · ${player.distance_m.toFixed(1)}m`
                : ""}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-slate-500 text-center">
        Bird&apos;s-eye court ({courtWidthM}m × {courtHeightM}m)
      </p>
    </div>
  );
}
