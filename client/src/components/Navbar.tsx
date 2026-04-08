import { Link, useLocation } from "wouter";
import { Activity, Upload, Clock, GitCompareArrows, Tag, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "Sessions", icon: Clock },
  { href: "/upload", label: "Analyze", icon: Upload },
  { href: "/compare", label: "Compare", icon: GitCompareArrows },
  { href: "/pro-compare", label: "Pro Compare", icon: Trophy },
  { href: "/annotate", label: "Annotate", icon: Tag },
];

export default function Navbar() {
  const [location] = useLocation();

  return (
    <nav className="border-b border-padel-border bg-padel-dark/80 backdrop-blur-lg sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-bold text-lg">
          <Activity className="w-6 h-6 text-padel-green" />
          <span>Padel Analyzer</span>
        </Link>

        <div className="flex items-center gap-1">
          {links.map(({ href, label, icon: Icon }) => {
            const active =
              href === "/" ? location === "/" : location.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors",
                  active
                    ? "bg-padel-green/15 text-padel-green"
                    : "text-slate-400 hover:text-white hover:bg-white/5"
                )}
              >
                <Icon className="w-4 h-4" />
                <span className="hidden sm:inline">{label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
