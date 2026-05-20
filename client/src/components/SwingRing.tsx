import type { SwingPhase, SwingPhaseType } from "@shared/types";
import { PHASE_COLORS, PHASE_LABELS } from "@shared/types";
import { PHASE_ORDER, SWING_RING_CLOSE_SCORE } from "@shared/config";

type Props = {
  phases: SwingPhase[];
  /** 0–1: staged reveal progress (1 = fully drawn). */
  revealProgress?: number;
  className?: string;
};

const CX = 100;
const CY = 100;
const R_OUT = 58;
const R_IN = 40;
const GAP_DEG = 4;
const SEG = 360 / PHASE_ORDER.length;

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function donutSlicePath(
  startDeg: number,
  endDeg: number,
  r0: number,
  r1: number
): string {
  const large = endDeg - startDeg > 180 ? 1 : 0;
  const p1 = polar(CX, CY, r1, startDeg);
  const p2 = polar(CX, CY, r1, endDeg);
  const p3 = polar(CX, CY, r0, endDeg);
  const p4 = polar(CX, CY, r0, startDeg);
  return [
    `M ${p1.x} ${p1.y}`,
    `A ${r1} ${r1} 0 ${large} 1 ${p2.x} ${p2.y}`,
    `L ${p3.x} ${p3.y}`,
    `A ${r0} ${r0} 0 ${large} 0 ${p4.x} ${p4.y}`,
    "Z",
  ].join(" ");
}

function phaseMap(phases: SwingPhase[]): Map<SwingPhaseType, SwingPhase> {
  return new Map(phases.map((p) => [p.type, p]));
}

export default function SwingRing({
  phases,
  revealProgress = 1,
  className = "",
}: Props) {
  const byType = phaseMap(phases);
  const pVis = Math.max(0, Math.min(1, revealProgress));

  return (
    <div className={`flex flex-col items-center ${className}`}>
      <svg
        width={200}
        height={200}
        viewBox="0 0 200 200"
        className="shrink-0"
        aria-label="Swing phase completion rings"
      >
        {PHASE_ORDER.map((type, i) => {
          const start = i * SEG + GAP_DEG / 2;
          const end = (i + 1) * SEG - GAP_DEG / 2;
          const phase = byType.get(type);
          const score = phase?.score ?? 0;
          const fillRatio = Math.min(1, score / SWING_RING_CLOSE_SCORE);
          const color = PHASE_COLORS[type];
          const trackPath = donutSlicePath(start, end, R_IN, R_OUT);
          const arcSpan = end - start;
          const scoreEnd = start + arcSpan * fillRatio * pVis;
          const scorePath =
            fillRatio > 0 && scoreEnd > start + 0.5
              ? donutSlicePath(start, scoreEnd, R_IN, R_OUT)
              : "";

          return (
            <g key={type}>
              <path
                d={trackPath}
                fill="#1e293b"
                stroke="#334155"
                strokeWidth={0.5}
              />
              {scorePath ? (
                <path
                  d={scorePath}
                  fill={color}
                  fillOpacity={0.92}
                />
              ) : null}
            </g>
          );
        })}
        <circle cx={CX} cy={CY} r={R_IN - 6} fill="#0f172a" stroke="#334155" strokeWidth={1} />
      </svg>
      <ul className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1 text-[10px] text-slate-500 w-full max-w-[200px]">
        {PHASE_ORDER.map((type) => {
          const phase = byType.get(type);
          const score = phase?.score ?? 0;
          const closed = score >= SWING_RING_CLOSE_SCORE;
          return (
            <li key={type} className="flex items-center gap-1.5 min-w-0">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: PHASE_COLORS[type] }}
              />
              <span className="truncate">{PHASE_LABELS[type]}</span>
              <span className={closed ? "text-padel-green font-semibold" : "text-slate-400"}>
                {score}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
