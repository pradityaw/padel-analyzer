import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Button } from "@/components/ui/Button";
import { hasSeenTour, markTourComplete } from "@/lib/firstRun";

const STEPS = [
  {
    target: '[data-coach="how-it-works"]',
    title: "How it works",
    body: "Upload or link a clip, we track your body through the swing, then score each phase.",
  },
  {
    target: '[data-coach="upload-tabs"]',
    title: "Choose your source",
    body: "Drop a video file or paste a YouTube URL — side-on framing works best.",
  },
  {
    target: '[data-testid="upload-dropzone"]',
    title: "Drop your swing",
    body: "When you're ready, add your clip here. Most short videos finish in under a minute.",
  },
] as const;

type Props = {
  active: boolean;
  onComplete?: () => void;
};

export default function CoachMarks({ active, onComplete }: Props) {
  const [step, setStep] = useState(0);
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const prefersReduced = useReducedMotion();

  const dismiss = useCallback(() => {
    markTourComplete();
    setOpen(false);
    onComplete?.();
  }, [onComplete]);

  const goNext = useCallback(() => {
    if (step >= STEPS.length - 1) {
      dismiss();
      return;
    }
    setStep((s) => s + 1);
  }, [step, dismiss]);

  useEffect(() => {
    if (!active || hasSeenTour()) {
      setOpen(false);
      return;
    }
    setStep(0);
    setOpen(true);
  }, [active]);

  useEffect(() => {
    if (!open) return;
    const sel = STEPS[step]?.target;
    if (!sel) return;
    const el = document.querySelector(sel);
    if (el instanceof HTMLElement) {
      setAnchorRect(el.getBoundingClientRect());
    } else {
      setAnchorRect(null);
    }
  }, [open, step]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, dismiss]);

  if (!active || hasSeenTour()) return null;

  const current = STEPS[step];
  const tooltipTop = anchorRect ? anchorRect.bottom + 12 : "50%";
  const tooltipLeft = anchorRect
    ? Math.min(Math.max(16, anchorRect.left), window.innerWidth - 376)
    : 16;

  return (
    <AnimatePresence>
      {open && anchorRect ? (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="coach-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: prefersReduced ? 0 : 0.2 }}
          className="fixed inset-0 z-[60]"
        >
          <button
            type="button"
            aria-label="Dismiss tour"
            className="absolute inset-0 bg-black/60 cursor-default"
            onClick={dismiss}
          />
          <motion.div
            className="absolute rounded-xl ring-2 ring-padel-green pointer-events-none"
            style={{
              top: anchorRect.top - 4,
              left: anchorRect.left - 4,
              width: anchorRect.width + 8,
              height: anchorRect.height + 8,
              boxShadow: "0 0 0 9999px rgba(0,0,0,0.6)",
            }}
          />
          <motion.div
            className="absolute z-[70] w-[min(100vw-2rem,360px)] rounded-xl border border-padel-border bg-padel-surface p-5 shadow-2xl"
            style={{ top: tooltipTop, left: tooltipLeft }}
          >
            <p className="text-xs text-padel-green font-semibold uppercase tracking-wider mb-1">
              Step {step + 1} of {STEPS.length}
            </p>
            <p id="coach-title" className="font-semibold text-white mb-2">
              {current?.title}
            </p>
            <p className="text-sm text-slate-400 mb-4">{current?.body}</p>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" className="flex-1" onClick={dismiss}>
                Skip tour
              </Button>
              <Button size="sm" className="flex-1" onClick={goNext}>
                {step >= STEPS.length - 1 ? "Got it" : "Next"}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
