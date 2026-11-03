"use client";

import { useActionState, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { FEEDBACK_MAX, placeOf } from "@/lib/feedback";
import { sendFeedbackAction, type FeedbackResult } from "@/app/app/feedback-actions";

/**
 * Feedback to Waivern from any page.
 *
 * In the same corner of every page, so people learn where it is. It says
 * which page the feedback is about, because that is recorded with it, and
 * that it is anonymous unless the person chooses to share their address.
 */
export function FeedbackButton({ email }: { email: string }) {
  const pathname = usePathname();
  const { label } = placeOf(pathname);
  const [open, setOpen] = useState(false);
  // Counting the sends keys the form, so a new one follows each send and the
  // words and the tick go with the old one.
  const [{ result, sent }, action, pending] = useActionState<{ result: FeedbackResult; sent: number }, FormData>(
    async (previous, formData) => {
      const result = await sendFeedbackAction(null, formData);
      return { result, sent: result?.ok ? previous.sent + 1 : previous.sent };
    },
    { result: null, sent: 0 },
  );

  useEffect(() => {
    if (!open) return;
    document.getElementById("feedback-message")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] z-40 flex flex-col items-end gap-2 print:hidden">
      {open ? (
        <section
          role="dialog"
          aria-labelledby="feedback-heading"
          className="w-[min(24rem,calc(100vw-2rem))] space-y-3 rounded border border-line bg-surface p-4 text-sm shadow-lg"
        >
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="feedback-heading" className="font-semibold">Feedback to Waivern</h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-xs text-ink-soft hover:text-brand focus-visible:outline-2 focus-visible:outline-brand"
            >
              Close
            </button>
          </div>
          <p className="text-xs text-ink-soft">
            About: <span className="font-medium text-ink">{label}</span>. This goes to Waivern, who make the
            tool, not to your organisation.
          </p>
          <form key={sent} action={action} className="space-y-3">
            <input type="hidden" name="pathname" value={pathname} />
            <MessageField />
            <label className="flex items-start gap-2.5 text-xs">
              <input id="feedback-share-email" type="checkbox" name="shareEmail" className="mt-0.5 accent-brand" />
              <span>
                Waivern may email me at <span className="font-mono">{email}</span> to follow up.
                <span className="block text-ink-soft">
                  Unticked, it is sent anonymously: Waivern sees your words and which page you were on, and nothing
                  about who you are or which organisation you work for.
                </span>
              </span>
            </label>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p role="status" className={`text-xs ${result && !result.ok ? "text-red-900" : "text-ink-soft"}`}>
                {result?.message ?? ""}
              </p>
              <button
                type="submit"
                disabled={pending}
                className="rounded border border-line bg-surface px-3 py-1.5 text-sm hover:border-brand focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-50"
              >
                {pending ? "Sending…" : "Send feedback"}
              </button>
            </div>
          </form>
        </section>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="rounded-full border border-line bg-surface px-4 py-2 text-xs font-medium shadow hover:border-brand focus-visible:outline-2 focus-visible:outline-brand"
      >
        Feedback
      </button>
    </div>
  );
}

/** The words, with a count against the limit. Inside the keyed form, so both start again after a send. */
function MessageField() {
  const [length, setLength] = useState(0);
  return (
    <label className="block space-y-1">
      <span className="sr-only">Your feedback</span>
      <textarea
        id="feedback-message"
        name="message"
        rows={5}
        maxLength={FEEDBACK_MAX}
        required
        placeholder="What worked, what didn't, or what you expected to find here"
        onChange={(e) => setLength(e.target.value.length)}
        className="w-full rounded border border-line bg-ground px-3 py-2 text-sm"
      />
      <span className="block text-right font-mono text-[11px] text-ink-soft">
        {length} / {FEEDBACK_MAX}
      </span>
    </label>
  );
}
