import { useRef } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";
import { Upload, Zap, BarChart3 } from "lucide-react";
import { Section } from "@/components/ui/Section";
import { Card } from "@/components/ui/Card";

const STEPS = [
  {
    icon: Upload,
    title: "Upload your swing",
    desc: "Record from the side, drop a file, or paste a YouTube link on web.",
  },
  {
    icon: Zap,
    title: "Analyze in your browser",
    desc: "MediaPipe tracks 33 landmarks per frame — ready, contact, follow-through.",
  },
  {
    icon: BarChart3,
    title: "Compare and improve",
    desc: "Phase scores, coaching tips, session history, and pro benchmarks.",
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
      transition: { staggerChildren: prefersReduced ? 0 : 0.15 },
    },
  };
  const item = {
    hidden: { opacity: 0, y: prefersReduced ? 0 : 24 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.45 } },
  };

  return (
    <Section
      label="How it works"
      title="From clip to coaching in three steps"
      subtitle="Most short swings finish in 30 seconds to 3 minutes depending on length and device."
    >
      <motion.div
        ref={ref}
        className="grid grid-cols-1 md:grid-cols-3 gap-6"
        variants={container}
        initial="hidden"
        animate={inView ? "visible" : "hidden"}
      >
        {STEPS.map((step) => (
          <motion.div key={step.title} variants={item}>
            <Card variant="gradient" className="h-full text-center">
              <div className="w-11 h-11 rounded-lg bg-padel-green/15 flex items-center justify-center mx-auto mb-4">
                <step.icon className="w-5 h-5 text-padel-green" aria-hidden />
              </div>
              <h3 className="font-semibold text-lg mb-2">{step.title}</h3>
              <p className="text-sm text-slate-400">{step.desc}</p>
            </Card>
          </motion.div>
        ))}
      </motion.div>
    </Section>
  );
}
