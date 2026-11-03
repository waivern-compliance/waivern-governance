import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { HomeLink } from "@/components/HomeLink";
import { Wordmark } from "@/components/Wordmark";
import { isPlatformAdmin } from "@/lib/platform";
import { feedbackInbox } from "@/services/feedback";
import { deleteFeedbackAction, markHandledAction } from "./actions";

const when = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ");

/**
 * Waivern's operators: feedback on the product, from any page of the app.
 *
 * Anonymous unless the person shared their email address for a follow-up;
 * nothing here says who else gave it or for which organisation. Shown only to
 * the people named in PLATFORM_ADMINS; everyone else gets a 404.
 */
export default async function FeedbackInbox() {
  const session = await auth();
  if (!session?.user?.email) redirect("/sign-in");
  if (!isPlatformAdmin(session.user.email)) notFound();

  const rows = await feedbackInbox();
  const open = rows.filter((r) => !r.handledAt);
  const handled = rows.filter((r) => r.handledAt);

  const item = (r: (typeof rows)[number]) => (
    <li key={r.id} className="space-y-2 px-4 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium">
          {r.placeLabel} <span className="font-mono text-[11px] font-normal text-ink-soft">{r.place}</span>
        </span>
        <span className="font-mono text-[11px] text-ink-soft">{when(r.createdAt)}</span>
      </div>
      <p className="whitespace-pre-wrap text-sm">{r.message}</p>
      <p className="text-xs text-ink-soft">
        {r.contactEmail ? (
          <>
            Happy to be contacted: <span className="select-all font-mono text-ink">{r.contactEmail}</span>
          </>
        ) : (
          "Anonymous"
        )}
      </p>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <form action={markHandledAction.bind(null, r.id, !r.handledAt)}>
          <button type="submit" className="rounded border border-line bg-surface px-2.5 py-1 hover:border-brand">
            {r.handledAt ? "Reopen" : "Mark dealt with"}
          </button>
        </form>
        <details>
          <summary className="cursor-pointer text-ink-soft hover:text-brand">Delete…</summary>
          <form action={deleteFeedbackAction.bind(null, r.id)} className="mt-2 flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" name="confirm" required className="accent-brand" />
              Delete this feedback{r.contactEmail ? " and the email address with it" : ""}
            </label>
            <button type="submit" className="rounded border border-line bg-surface px-2.5 py-1 hover:border-red-700">
              Delete
            </button>
          </form>
        </details>
      </div>
    </li>
  );

  return (
    <>
      <header className="bg-navy text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-6 px-6 py-3">
          <div className="flex items-center gap-4">
            <HomeLink />
            <Link href="/app" title="Home" className="rounded focus-visible:outline-2 focus-visible:outline-white">
              <Wordmark />
            </Link>
          </div>
          <span className="font-mono text-[11px] text-white/70">Waivern platform</span>
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-8 px-6 py-12">
        <header className="space-y-1 border-b border-line pb-6">
          <p className="text-xs">
            <Link href="/platform" className="text-ink-soft hover:text-brand">← Requests for new organisations</Link>
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Feedback</h1>
          <p className="max-w-prose text-sm text-ink-soft">
            From the Feedback button on every page. Each is anonymous unless the person shared their email address
            for a follow-up. The page shows where it was given, with record ids taken out.
          </p>
        </header>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-soft">To deal with ({open.length})</h2>
          {open.length === 0 ? (
            <p className="text-sm text-ink-soft">Nothing new.</p>
          ) : (
            <ul className="divide-y divide-line rounded border border-line bg-surface">{open.map(item)}</ul>
          )}
        </section>

        {handled.length > 0 ? (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-soft">Dealt with ({handled.length})</h2>
            <ul className="divide-y divide-line rounded border border-line bg-surface">{handled.map(item)}</ul>
          </section>
        ) : null}
      </main>
    </>
  );
}
