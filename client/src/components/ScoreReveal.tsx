import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import ScoreCard from "@/components/ScoreCard";
import { markScoreRevealShown } from "@/lib/firstRun";

type Props = {
  open: boolean;
  score: number;
  onClose: () => void;
};

function ConfettiDot({ delay, x }: { delay: number; x: number }) {
  const prefersReduced = useReducedMotion();
  if (prefersReduced) return null;
  return (
    <motion.span
      className="absolute w-1.5 h-1.5 rounded-full bg-padel-green"
      style={{ left: `${x}%`, top: "20%" }}
      initial={{ opacity: 1, y: 0, scale: 1 }}
      animate={{ opacity: 0, y: 80, scale: 0.5 }}
      transition={{ duration: 1.2, delay, ease: "easeOut" }}
    />
  );
}

export default function ScoreReveal({ open, score, onClose }: Props) {
  const [, navigate] = useLocation();
  const prefersReduced = useReducedMotion();
  const [displayScore, setDisplayScore] = useState(0);

  useEffect(() => {
    if (!open) return;
    if (prefersReduced) {
      setDisplayScore(score);
      return;
    }
    let frame = 0;
    const total = 24;
    const id = window.setInterval(() => {
      frame += 1;
      setDisplayScore(Math.round((score * frame) / total));
      if (frame >= total) window.clearInterval(id);
    }, 40);
    return () => window.clearInterval(id);
  }, [open, score, prefersReduced]);

  const handleContinue = () => {
    markScoreRevealShown();
    onClose();
    navigate("/sessions");
  };

  const handleDismiss = () => {
    markScoreRevealShown();
    onClose();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="score-reveal-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 px-4"
        >
          <motion.div
            initial={{ scale: prefersReduced ? 1 : 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            className="relative bg-padel-surface border border-padel-border rounded-2xl shadow-2xl max-w-md w-full p-8 text-center overflow-hidden"
          >
            {!prefersReduced &&
              [10, 25, 40, 55, 70, 85].map((x, i) => (
                <ConfettiDot key={x} x={x} delay={i * 0.08} />
              ))}
            <Sparkles className="w-8 h-8 text-padel-green mx-auto mb-3" />
            <p
              id="score-reveal-title"
              className="text-sm text-slate-400 mb-2"
            >
              Your first swing score
            </p>
            <div className="flex justify-center mb-4">
              <ScoreCard score={displayScore} size="lg" />
            </div>
            <p className="text-slate-300 text-sm mb-6">
              Save this session to your history and track progress over time.
            </p>
            <Button className="w-full mb-2" onClick={handleContinue}>
              View my sessions
            </Button>
            <button
              type="button"
              onClick={handleDismiss}
              className="text-sm text-slate-500 hover:text-slate-300 w-full py-2 focus-ring rounded-lg"
            >
              Keep exploring this analysis
            </button>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
