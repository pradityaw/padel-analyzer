import SportPattern from "@/components/ui/SportPattern";
import { SHOT_TYPE_LABELS } from "@shared/types";

type PreviewCard = {
  label: string;
  score: string;
  meta: string;
  flood: string;
  pattern: "mesh" | "diagonal" | "dots";
  rotate: string;
  zIndex: number;
  offset: string;
};

const CARDS: PreviewCard[] = [
  {
    label: SHOT_TYPE_LABELS.volley,
    score: "8.2",
    meta: "Sample · side view",
    flood: "#3b82f6",
    pattern: "mesh",
    rotate: "-6deg",
    zIndex: 1,
    offset: "translate-x-0",
  },
  {
    label: SHOT_TYPE_LABELS.bandeja,
    score: "7.4",
    meta: "Sample · drill clip",
    flood: "#f59e0b",
    pattern: "diagonal",
    rotate: "4deg",
    zIndex: 2,
    offset: "translate-x-6 -translate-y-4",
  },
  {
    label: SHOT_TYPE_LABELS.drive,
    score: "6.8",
    meta: "Sample · baseline",
    flood: "#22c55e",
    pattern: "dots",
    rotate: "-2deg",
    zIndex: 3,
    offset: "translate-x-12 -translate-y-8",
  },
];

/** Fixtured-style overlapping flood cards for splash / hero (honest sample labels). */
export default function StackedSessionCards({ className }: { className?: string }) {
  return (
    <div
      className={`relative mx-auto h-[220px] w-full max-w-[320px] sm:h-[260px] sm:max-w-[360px] ${className ?? ""}`}
      aria-hidden
    >
      {CARDS.map((card) => (
        <div
          key={card.label}
          className={`absolute left-0 top-4 w-[88%] rounded-2xl p-5 text-ink shadow-2xl ${card.offset}`}
          style={{
            backgroundColor: card.flood,
            transform: `rotate(${card.rotate})`,
            zIndex: card.zIndex,
          }}
        >
          <SportPattern variant={card.pattern} />
          <p className="relative text-[10px] font-semibold uppercase tracking-[0.16em] text-white/70">
            {card.label}
          </p>
          <p className="relative mt-2 font-display-condensed text-4xl tabular-nums">
            {card.score}
          </p>
          <p className="relative mt-1 text-xs text-white/70">{card.meta}</p>
        </div>
      ))}
    </div>
  );
}
