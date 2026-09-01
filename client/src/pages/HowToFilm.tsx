/* Hallmark · design-system: design.md · designed-as-app · theme: studied-DNA "Court Flood" */
import { Link } from "wouter";

export default function HowToFilm() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10 text-sm leading-relaxed text-ink-2">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-2">
        Tester guide
      </p>
      <h1 className="font-display-condensed text-3xl text-ink">How to film</h1>
      <p>
        This beta scores <strong className="text-ink">pose + swing phases</strong>{" "}
        only. Ball and racket overlays are off. A clean side-on clip is the
        difference between useful feedback and a low-detection banner.
      </p>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-ink">Setup</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Stand to the side of the player, not behind the glass or the net.</li>
          <li>Keep the full body in frame: feet through follow-through.</li>
          <li>Film <strong className="text-ink">20–30 seconds</strong> of actual swings.</li>
          <li>Use daylight or bright court lights. Avoid backlight from windows.</li>
          <li>Hold the phone landscape and still (a bag or fence is fine).</li>
        </ul>
      </section>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-ink">What to skip</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Walking back to serve, between-point chat, or long warm-ups.</li>
          <li>Clips longer than a minute — analysis time grows with video length.</li>
          <li>YouTube imports (not part of this tester round).</li>
        </ul>
      </section>
      <p>
        <Link href="/app/upload" className="font-semibold text-accent hover:underline">
          Back to upload
        </Link>
        {" · "}
        <Link href="/privacy" className="font-semibold text-accent hover:underline">
          Privacy
        </Link>
      </p>
    </div>
  );
}
