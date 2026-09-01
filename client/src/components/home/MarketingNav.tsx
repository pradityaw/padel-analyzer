import { Link } from "wouter";

export default function MarketingNav() {
  return (
    <header className="sticky top-0 z-50 h-14 border-b border-rule bg-paper/90 backdrop-blur-lg">
      <div className="max-w-6xl mx-auto px-4 h-full flex items-center justify-between">
        <Link
          href="/"
          className="font-display-condensed text-lg text-ink rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          Padel&nbsp;Analyzer
        </Link>
        <Link
          href="/login"
          className="inline-flex items-center rounded-full border border-white/15 bg-white/10 px-4 py-1.5 text-sm font-medium text-ink hover:bg-white/15 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          Log in
        </Link>
      </div>
    </header>
  );
}
