import { motion } from "framer-motion";
import { trpc } from "@/lib/trpc";
import Hero from "@/components/home/Hero";
import HowItWorks from "@/components/home/HowItWorks";
import TrustStrip from "@/components/home/TrustStrip";
import RecentSessionsTeaser from "@/components/home/RecentSessionsTeaser";

export default function Home() {
  const listQuery = trpc.analysis.list.useQuery({ limit: 10 });
  const analyses = listQuery.data?.items ?? [];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <Hero />
      <HowItWorks />
      <TrustStrip />
      {analyses.length > 0 ? (
        <RecentSessionsTeaser analyses={analyses} />
      ) : null}
    </motion.div>
  );
}
