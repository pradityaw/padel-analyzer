import { Shield, Cpu, Sparkles } from "lucide-react";
import { Section } from "@/components/ui/Section";
import { trpc } from "@/lib/trpc";

const BADGES = [
  {
    icon: Cpu,
    title: "Runs in your browser",
    desc: "Pose detection happens on your device with MediaPipe.",
  },
  {
    icon: Shield,
    title: "Privacy-first",
    desc: "Read our data policy before you share clips on hosted beta.",
  },
  {
    icon: Sparkles,
    title: "Open beta",
    desc: "Upload a swing, get pose-based feedback in under a minute.",
  },
] as const;

export default function TrustStrip() {
  const session = trpc.auth.getSession.useQuery();
  const authOff = session.data?.authMode !== "on";

  return (
    <Section className="py-12 md:py-16 border-t border-padel-border bg-padel-dark/50">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        {BADGES.map((badge, i) => (
          <div
            key={badge.title}
            className="flex gap-4 items-start rounded-xl border border-padel-border/60 bg-padel-surface/50 p-4"
          >
            <div className="shrink-0 w-10 h-10 rounded-lg bg-padel-green/10 flex items-center justify-center">
              <badge.icon className="w-5 h-5 text-padel-green" aria-hidden />
            </div>
            <div>
              <p className="font-semibold text-sm text-slate-200">{badge.title}</p>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                {i === 1 && authOff
                  ? "Local dev mode — videos stay on your machine unless you deploy with auth."
                  : badge.desc}
              </p>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}
