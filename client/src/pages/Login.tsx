/* Hallmark · design-system: design.md · designed-as-app · theme: studied-DNA "Court Flood" (source: image) */
import { useEffect, useState } from "react";
import { useLocation, Link, useSearch } from "wouter";
import { motion } from "framer-motion";
import StackedSessionCards from "@/components/ui/StackedSessionCards";
import { trpc } from "@/lib/trpc";

export default function Login() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const nextPath =
    new URLSearchParams(search).get("next")?.startsWith("/")
      ? new URLSearchParams(search).get("next")!
      : "/app";
  const [email, setEmail] = useState("");
  const [banner, setBanner] = useState("");

  const session = trpc.auth.getSession.useQuery(undefined, { retry: false });
  const requestLink = trpc.auth.requestMagicLink.useMutation({
    onSuccess: (data) => {
      setBanner(
        data.devMagicLinkUrl
          ? `Dev mode: open this link in the same browser as the app: ${data.devMagicLinkUrl}`
          : "If outbound email is configured, you will receive a sign-in link shortly."
      );
    },
    onError: (e) => setBanner(e.message),
  });

  useEffect(() => {
    if (!session.data) return;
    if (session.data.authMode === "off" || session.data.user) {
      navigate(nextPath);
    }
  }, [session.data, navigate, nextPath]);

  if (session.isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-paper">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-1 flex-col items-center justify-center px-4 py-12"
      >
        <div className="w-full max-w-md">
          <Link
            href="/"
            className="mb-8 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink"
          >
            ← Back
          </Link>

          <div className="mb-10 flex justify-center">
            <StackedSessionCards />
          </div>

          <h1 className="text-center font-display-condensed text-3xl text-ink">
            Sign in to Padel Analyzer
          </h1>
          <p className="mt-2 text-center text-sm text-muted-2">
            Magic-link authentication — no password.
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              setBanner("");
              requestLink.mutate({ email });
            }}
            className="mt-8 space-y-4"
          >
            <div>
              <label
                htmlFor="email"
                className="mb-1 block text-xs font-semibold uppercase tracking-[0.16em] text-muted-2"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-rule bg-raised px-3 py-3 text-sm text-ink focus:border-accent focus:outline-none"
                placeholder="you@example.com"
                autoComplete="email"
              />
            </div>
            <button
              type="submit"
              disabled={requestLink.isPending}
              className="w-full min-h-11 rounded-full bg-cta py-3 text-sm font-bold text-cta-ink hover:bg-white/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              {requestLink.isPending ? "Sending…" : "Email me a link"}
            </button>
          </form>

          {banner ? (
            <p className="mt-4 break-words text-xs text-ink-2">{banner}</p>
          ) : null}
        </div>
      </motion.div>
    </div>
  );
}
