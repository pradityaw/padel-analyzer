import { useLocation } from "wouter";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Play } from "lucide-react";
import { Button } from "@/components/ui/Button";
import AnimatedSkeletonDemo from "@/components/home/AnimatedSkeletonDemo";
import { trpc } from "@/lib/trpc";
import { DEMO_ANALYSIS_ID } from "@/lib/sampleAnalysis";

function uploadHref(authOn: boolean, signedIn: boolean): string {
  const target = "/upload?tour=1";
  if (authOn && !signedIn) {
    return `/login?next=${encodeURIComponent(target)}`;
  }
  return target;
}

export default function Hero() {
  const [, navigate] = useLocation();
  const prefersReduced = useReducedMotion();
  const session = trpc.auth.getSession.useQuery();
  const authOn = session.data?.authMode === "on";
  const signedIn = !!session.data?.user;

  const container = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: prefersReduced ? 0 : 0.12, delayChildren: 0.1 },
    },
  };
  const item = {
    hidden: { opacity: 0, y: prefersReduced ? 0 : 20 },
    visible: { opacity: 1, y: 0 },
  };

  return (
    <section className="relative overflow-hidden border-b border-padel-border">
      <div className="max-w-6xl mx-auto px-4 py-16 md:py-24">
        <motion.div
          className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center"
          variants={container}
          initial="hidden"
          animate="visible"
        >
          <div>
            <motion.p
              variants={item}
              className="text-xs font-semibold uppercase tracking-widest text-padel-green mb-4"
            >
              Open beta · AI swing coaching
            </motion.p>
            <motion.h1
              variants={item}
              className="display text-5xl sm:text-6xl lg:text-7xl mb-5 text-white"
            >
              See your padel swing{" "}
              <span className="text-padel-green">like a pro coach</span>
            </motion.h1>
            <motion.p
              variants={item}
              className="text-lg text-slate-400 max-w-lg mb-8"
            >
              Upload a clip, get pose-based feedback in under a minute. Track 33
              body points, score every phase, and close the gap to pro form.
            </motion.p>
            <motion.div
              variants={item}
              className="flex flex-col sm:flex-row gap-3"
            >
              <Button
                asMotion
                size="md"
                className="text-base px-6 py-3"
                onClick={() => navigate(uploadHref(authOn, signedIn))}
              >
                Analyze your swing
                <ArrowRight className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="md"
                className="text-base px-6 py-3"
                onClick={() => navigate(`/analysis/${DEMO_ANALYSIS_ID}`)}
              >
                <Play className="w-4 h-4" />
                See a sample analysis
              </Button>
            </motion.div>
            <motion.p variants={item} className="text-sm text-slate-500 mt-4">
              No account required for local try · Works in your browser
            </motion.p>
          </div>
          <motion.div variants={item} className="flex justify-center lg:justify-end">
            <AnimatedSkeletonDemo />
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
