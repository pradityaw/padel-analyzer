import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";

const links = [
  { href: "/app", label: "Sessions" },
  { href: "/app/upload", label: "Analyze" },
  { href: "/app/compare", label: "Compare" },
  { href: "/app/pro-compare", label: "Pro Compare" },
  { href: "/app/annotate", label: "Annotate" },
];

export default function Navbar() {
  const [location] = useLocation();

  return (
    <nav className="border-b border-rule bg-paper/90 backdrop-blur-lg sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
        <Link
          href="/app"
          className="font-display-condensed text-lg text-ink shrink-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          Padel&nbsp;Analyzer
        </Link>

        <div className="flex items-center gap-1 overflow-x-auto h-full" role="list">
          {links.map(({ href, label }) => {
            const active =
              href === "/app" ? location === "/app" : location.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex items-center h-full px-3 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 rounded-sm",
                  active ? "text-ink" : "text-ink-2 hover:text-ink"
                )}
              >
                {label}
                {active ? (
                  <span
                    aria-hidden
                    className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-accent"
                  />
                ) : null}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
