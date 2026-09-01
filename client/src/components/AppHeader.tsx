import { Link } from "wouter";

/** Minimal top bar — navigation lives in the floating pill (Fixtured pattern). */
export default function AppHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-rule/60 bg-paper/80 backdrop-blur-lg">
      <div className="mx-auto flex h-12 max-w-5xl items-center px-4">
        <Link
          href="/"
          className="font-display-condensed text-base text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 sm:text-lg"
        >
          Padel&nbsp;Analyzer
        </Link>
      </div>
    </header>
  );
}
