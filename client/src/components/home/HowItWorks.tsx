import { useRef } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";
import SportPattern from "@/components/ui/SportPattern";

const STEPS = [
  {
    num: "01",
    title: "Upload your swing",
    desc: "Record from the side, drop a file, or paste a YouTube link on web.",
    flood: "#2b3fbd",
    pattern: "mesh" as const,
  },
  {
    num: "02",
    title: "Analyze in your browser",
    desc: "MediaPipe tracks 33 landmarks per frame — ready, contact, follow-through.",
    flood: "#22c55e",
    pattern: "diagonal" as const,
  },
  {
    num: "03",
    title: "Compare and improve",
    desc: "Phase scores, coaching tips, session history, and pro benchmarks.",
    flood: "#f59e0b",
    pattern: "dots" as const,
  },
] as const;

export default function HowItWorks() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const prefersReduced = useReducedMotion();

  const container = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: prefersReduced ? 0 : 0.1 },
    },
  };
  const item = {
    hidden: { opacity: 0, y: prefersReduced ? 0 : 16 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.35 } },
  };

  return (
    <section className="border-b border-rule px-4 py-16 md:py-20">
      <div className="mx-auto max-w-3xl">
        <h2 className="font-display-condensed text-3xl text-ink sm:text-4xl">
          How it works
        </h2>
        <p className="mt-3 text-ink-2">
          Most short swings finish in 30 seconds to 3 minutes depending on length
          and device.
        </p>
        <motion.div
          ref={ref}
          variants={container}
          initial="hidden"
          animate={inView ? "visible" : "hidden"}
          className="mt-10 space-y-4"
        >
          {STEPS.map((step) => (
            <motion.div
              key={step.num}
              variants={item}
              className="relative overflow-hidden rounded-2xl p-6 text-ink"
              style={{ backgroundColor: step.flood }}
            >
              <SportPattern variant={step.pattern} />
              <span className="relative text-[10px] font-semibold uppercase tracking-[0.16em] text-white/70">
                Step {step.num}
              </span>
              <h3 className="relative mt-2 font-display-condensed text-2xl">
                {step.title}
              </h3>
              <p className="relative mt-2 text-sm leading-relaxed text-white/80">
                {step.desc}
              </p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
