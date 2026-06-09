import { useLocation } from "wouter";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Play } from "lucide-react";
import { Button } from "@/components/ui/Button";
import StackedSessionCards from "@/components/ui/StackedSessionCards";
import { trpc } from "@/lib/trpc";
import { DEMO_ANALYSIS_ID } from "@/lib/sampleAnalysis";

function uploadHref(authOn: boolean, signedIn: boolean): string {
  const target = "/app/upload?tour=1";
  if (authOn && !signedIn) {
    return `/login?next=${encodeURIComponent(target)}`;
  }
  return target;
}

export default function Hero() {
  const [, navigate] = useLocation();
  const prefersReduced = useReducedMotion();
  const session = trpc.auth.getSession.useQuery(undefined, { retry: false });
  const authOn = session.data?.authMode === "on";
  const signedIn = !!session.data?.user;

  const container = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: prefersReduced ? 0 : 0.1, delayChildren: 0.05 },
    },
  };
  const item = {
    hidden: { opacity: 0, y: prefersReduced ? 0 : 16 },
    visible: { opacity: 1, y: 0 },
  };

  return (
    <section className="relative overflow-hidden border-b border-rule">
      <div className="mx-auto max-w-6xl px-4 py-14 md:py-20">
        <motion.div
          className="flex flex-col items-center gap-10 lg:flex-row lg:items-center lg:justify-between lg:gap-16"
          variants={container}
          initial="hidden"
          animate="visible"
        >
          <div className="order-2 w-full text-center lg:order-1 lg:max-w-xl lg:text-left">
            <motion.h1
              variants={item}
              className="font-display-condensed text-5xl text-ink sm:text-6xl lg:text-7xl"
              style={{ overflowWrap: "anywhere", minWidth: 0 }}
            >
              Your padel swing schedule
            </motion.h1>
            <motion.p
              variants={item}
              className="mx-auto mt-5 max-w-lg text-lg text-ink-2 lg:mx-0"
            >
              Upload a clip, get pose-based feedback in under a minute. Track 33
              body points, score every phase, and close the gap to pro form.
            </motion.p>
            <motion.div
              variants={item}
              className="mt-8 flex flex-col justify-center gap-3 sm:flex-row lg:justify-start"
            >
              <Button
                size="lg"
                className="min-h-11 px-7 py-3 text-base"
                onClick={() => navigate(uploadHref(authOn, signedIn))}
              >
                Analyze a swing
                <ArrowRight className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="lg"
                className="min-h-11 px-7 py-3 text-base"
                onClick={() => navigate(`/app/analysis/${DEMO_ANALYSIS_ID}`)}
              >
                <Play className="h-4 w-4" />
                See a sample analysis
              </Button>
            </motion.div>
            <motion.p variants={item} className="mt-4 text-sm text-muted-2">
              Works in your browser · No install required
            </motion.p>
          </div>
          <motion.div variants={item} className="order-1 w-full lg:order-2 lg:w-auto">
            <StackedSessionCards />
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
