import { Link, useLocation } from "wouter";
import {
  Clock,
  Upload,
  GitCompareArrows,
  Trophy,
  Tag,
} from "lucide-react";
import { cn } from "@/lib/utils";

const links = [
  { href: "/app", label: "Sessions", icon: Clock },
  { href: "/app/upload", label: "Analyze", icon: Upload },
  { href: "/app/compare", label: "Compare", icon: GitCompareArrows },
  { href: "/app/pro-compare", label: "Pro", icon: Trophy },
  { href: "/app/annotate", label: "Annotate", icon: Tag },
] as const;

/** Fixtured-style glass pill navigation — fixed bottom, icon-led. */
export default function FloatingNav() {
  const [location] = useLocation();

  return (
    <nav
      aria-label="App navigation"
      className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4 pointer-events-none"
    >
      <div className="pointer-events-auto flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full border border-white/15 bg-surface/75 px-2 py-2 shadow-2xl backdrop-blur-xl [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {links.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/app" ? location === "/app" : location.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex shrink-0 flex-col items-center gap-0.5 rounded-full px-3 py-2 text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 sm:flex-row sm:gap-1.5 sm:px-4 sm:text-xs",
                active
                  ? "bg-cta text-cta-ink"
                  : "text-ink-2 hover:bg-white/10 hover:text-ink"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              <span className="whitespace-nowrap">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
