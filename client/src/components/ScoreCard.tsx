import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

type Props = {
  score: number;
  label?: string;
  size?: "sm" | "lg";
};

function scoreColor(score: number): string {
  if (score >= 80) return "#a3e635";
  if (score >= 60) return "#f59e0b";
  return "#ef4444";
}

function useCountUp(target: number, duration = 1200) {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const startTime = performance.now();
    const animate = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(eased * target));
      if (t < 1) rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return value;
}

export default function ScoreCard({ score, label, size = "lg" }: Props) {
  const dim = size === "lg" ? 148 : 64;
  const stroke = size === "lg" ? 9 : 5;
  const r = (dim - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - score / 100);
  const color = scoreColor(score);
  const countUp = useCountUp(score);
  const displayScore = size === "lg" ? countUp : score;

  return (
    <div className="flex flex-col items-center relative" style={{ width: dim }}>
      <svg width={dim} height={dim} className="-rotate-90" style={{ display: "block" }}>
        {/* Track ring */}
        <circle
          cx={dim / 2}
          cy={dim / 2}
          r={r}
          fill="none"
          stroke="#1e293b"
          strokeWidth={stroke}
        />
        {/* Outer glow ring (subtle) */}
        {size === "lg" && (
          <circle
            cx={dim / 2}
            cy={dim / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke + 6}
            strokeOpacity={0.08}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
          />
        )}
        {/* Score arc */}
        <motion.circle
          cx={dim / 2}
          cy={dim / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.2, ease: "easeOut" }}
        />
      </svg>
      {/* Centered number — absolutely positioned over the SVG */}
      <div
        className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none"
      >
        <span
          className={size === "lg" ? "display tabular-nums leading-none" : "font-bold tabular-nums leading-none"}
          style={{ fontSize: size === "lg" ? 52 : 16, color }}
        >
          {displayScore}
        </span>
        {size === "lg" && (
          <span className="text-[10px] text-slate-500 tracking-widest uppercase mt-0.5">pts</span>
        )}
      </div>
      {label && (
        <span className="text-xs text-slate-400 mt-1">{label}</span>
      )}
    </div>
  );
}
