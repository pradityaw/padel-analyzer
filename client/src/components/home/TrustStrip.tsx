import { trpc } from "@/lib/trpc";

export default function TrustStrip() {
  const session = trpc.auth.getSession.useQuery(undefined, { retry: false });
  const authOff = session.data?.authMode !== "on";

  const items = [
    "Runs in your browser",
    authOff ? "Local dev — video stays on your machine" : "Privacy-first",
    "Open beta",
  ];

  return (
    <div className="text-xs font-semibold text-muted-2 uppercase tracking-[0.16em] text-center py-6 border-t border-rule">
      {items.map((item, i) => (
        <span key={item}>
          {i > 0 && (
            <span className="mx-2.5 opacity-40" aria-hidden>
              ·
            </span>
          )}
          {item}
        </span>
      ))}
    </div>
  );
}
