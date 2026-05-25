import { useEffect, useState } from "react";
import { useLocation, Link, useSearch } from "wouter";
import { motion } from "framer-motion";
import { ArrowLeft, Mail } from "lucide-react";
import { trpc } from "@/lib/trpc";

export default function Login() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const nextPath =
    new URLSearchParams(search).get("next")?.startsWith("/")
      ? new URLSearchParams(search).get("next")!
      : "/";
  const [email, setEmail] = useState("");
  const [banner, setBanner] = useState("");

  const session = trpc.auth.getSession.useQuery();
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
      <div className="flex justify-center items-center min-h-[50vh]">
        <div className="w-8 h-8 border-2 border-padel-green border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-md mx-auto px-4 py-12"
    >
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white mb-8"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to sessions
      </Link>

      <div className="bg-padel-surface border border-padel-border rounded-xl p-6">
        <div className="flex items-center gap-2 mb-2">
          <Mail className="w-5 h-5 text-padel-green" />
          <h1 className="text-xl font-bold">Sign in</h1>
        </div>
        <p className="text-sm text-slate-500 mb-6">
          Magic-link authentication. In development, the link is printed in the
          server terminal and shown below after you submit.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setBanner("");
            requestLink.mutate({ email });
          }}
          className="space-y-4"
        >
          <div>
            <label htmlFor="email" className="block text-xs text-slate-400 mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg bg-padel-dark border border-padel-border px-3 py-2 text-sm focus:outline-none focus:border-padel-green"
              placeholder="you@example.com"
              autoComplete="email"
            />
          </div>
          <button
            type="submit"
            disabled={requestLink.isPending}
            className="w-full py-2.5 rounded-lg bg-padel-green text-black font-bold text-sm hover:opacity-90 disabled:opacity-50"
          >
            {requestLink.isPending ? "Sending…" : "Email me a link"}
          </button>
        </form>

        {banner ? (
          <p className="mt-4 text-xs text-slate-400 break-words">{banner}</p>
        ) : null}
      </div>
    </motion.div>
  );
}
