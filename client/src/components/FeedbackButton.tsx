import { useState } from "react";
import { MessageSquare, X } from "lucide-react";
import { trpc } from "@/lib/trpc";

const TAGS = [
  { value: "looked_wrong", label: "Looked wrong" },
  { value: "slow", label: "Too slow" },
  { value: "crash", label: "Crash / error" },
  { value: "confusing", label: "Confusing" },
  { value: "other", label: "Other" },
] as const;

type FeedbackButtonProps = {
  analysisId?: number;
};

export default function FeedbackButton({ analysisId }: FeedbackButtonProps) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [tag, setTag] = useState<(typeof TAGS)[number]["value"] | "">("");
  const [done, setDone] = useState(false);

  const submit = trpc.feedback.submit.useMutation({
    onSuccess: () => {
      setDone(true);
    },
  });

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setDone(false);
        }}
        className="fixed bottom-24 right-4 z-40 inline-flex min-h-11 items-center gap-2 rounded-full bg-cta px-4 py-2 text-sm font-bold text-cta-ink shadow-2xl hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        data-testid="feedback-button"
      >
        <MessageSquare className="h-4 w-4" />
        Feedback
      </button>

      {open ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div
            role="dialog"
            aria-labelledby="feedback-title"
            className="w-full max-w-md rounded-2xl border border-rule bg-surface p-5 shadow-2xl"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p
                  id="feedback-title"
                  className="font-display-condensed text-xl text-ink"
                >
                  How did this feel?
                </p>
                <p className="mt-1 text-xs text-muted-2">
                  Pose + swing phases (beta). Tell us what was off.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close feedback"
                onClick={() => setOpen(false)}
                className="rounded-full p-2 text-ink-2 hover:bg-white/10 hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {done ? (
              <p className="text-sm text-ink-2">Thanks — we got your note.</p>
            ) : (
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (rating < 1) return;
                  submit.mutate({
                    analysisId,
                    rating,
                    comment: comment.trim() || undefined,
                    tag: tag || undefined,
                  });
                }}
              >
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-2">
                    Rating
                  </p>
                  <div className="flex gap-2">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setRating(n)}
                        className={`flex h-10 w-10 items-center justify-center rounded-full border text-sm font-bold ${
                          rating === n
                            ? "border-accent bg-accent text-cta-ink"
                            : "border-rule text-ink-2 hover:border-accent/50"
                        }`}
                        aria-label={`${n} of 5`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-2">
                    What felt wrong
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {TAGS.map((item) => (
                      <button
                        key={item.value}
                        type="button"
                        onClick={() =>
                          setTag((prev) => (prev === item.value ? "" : item.value))
                        }
                        className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                          tag === item.value
                            ? "border-accent bg-accent/15 text-accent"
                            : "border-rule text-ink-2 hover:border-accent/40"
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label
                    htmlFor="feedback-comment"
                    className="mb-1 block text-xs font-semibold uppercase tracking-[0.16em] text-muted-2"
                  >
                    Comment
                  </label>
                  <textarea
                    id="feedback-comment"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    maxLength={2000}
                    rows={3}
                    className="w-full rounded-xl border border-rule bg-raised px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
                    placeholder="Optional — what should we look at?"
                  />
                </div>
                {submit.error ? (
                  <p className="text-xs text-sand">{submit.error.message}</p>
                ) : null}
                <button
                  type="submit"
                  disabled={rating < 1 || submit.isPending}
                  className="w-full min-h-11 rounded-full bg-cta text-sm font-bold text-cta-ink hover:bg-white/90 disabled:opacity-50"
                >
                  {submit.isPending ? "Sending…" : "Send feedback"}
                </button>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
