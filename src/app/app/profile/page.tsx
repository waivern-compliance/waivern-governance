import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EMAILED_KINDS, STALE_AFTER_HOURS, memberEmailState } from "@/lib/email/member";
import { getActiveSession } from "@/lib/session";
import { emailNotificationsFor } from "@/services/member-email";
import { EmailNotificationsForm } from "./EmailNotificationsForm";

export const metadata: Metadata = { title: "Your profile" };

const linkClass = "text-brand underline underline-offset-2 hover:opacity-80";

/** The signed-in person's own settings: who they are here, and what they are emailed. */
export default async function ProfilePage() {
  const active = await getActiveSession();
  if (!active) redirect("/sign-in");

  const [choice, state] = [await emailNotificationsFor(active.userId), memberEmailState()];
  const hosted = state === "hosted";

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-6 py-12">
      <header className="space-y-1 border-b border-line pb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Your profile</h1>
        <p className="text-sm text-ink-soft">Settings that are yours alone, whichever organisation you are working in.</p>
      </header>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-soft">You</h2>
        <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
          <dt className="text-ink-soft">Name</dt>
          <dd>{active.name ?? "-"}</dd>
          <dt className="text-ink-soft">Email</dt>
          <dd className="break-all font-mono">{active.email}</dd>
        </dl>
        <p className="text-xs text-ink-soft">These come from the account you sign in with, and change there.</p>
      </section>

      <section className="space-y-3" aria-labelledby="email-notifications-heading">
        <h2 id="email-notifications-heading" className="text-sm font-semibold uppercase tracking-wider text-ink-soft">
          Alert and action emails
        </h2>
        <p id="email-notifications-help" className="max-w-prose text-sm">
          An email when something here needs you. Off unless you turn it on. Each one names the work and links to it;
          it does not carry the record&rsquo;s contents.
        </p>
        <ul className="list-disc space-y-0.5 pl-5 text-sm text-ink-soft">
          {Object.values(EMAILED_KINDS).map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ul>

        <EmailNotificationsForm on={!hosted && choice.on} disabled={hosted} />

        {hosted ? (
          <p className="max-w-prose rounded border border-line bg-surface p-4 text-sm">
            <strong className="block">Not available on the free hosted service.</strong>
            Alert and action emails come with an instance of your own: one Waivern hosts for your organisation alone,
            or one you host yourselves. See{" "}
            <Link href="/security#dedicated" className={linkClass}>
              a dedicated instance of your own
            </Link>
            , or ask your administrator. Until then, your <Link href="/app/tasks" className={linkClass}>Tasks</Link>{" "}
            page shows everything waiting on you.
          </p>
        ) : state !== "on" ? (
          <p className="max-w-prose text-sm text-ink-soft">
            Email has not been switched on for this instance yet, so nothing is sent. Your choice is kept, and emails
            start when it is. Notices older than {STALE_AFTER_HOURS} hours are not sent then.
          </p>
        ) : choice.on ? (
          <p className="max-w-prose text-sm text-ink-soft">
            Emails go to <span className="break-all font-mono">{active.email}</span>, usually within the hour.
          </p>
        ) : null}
      </section>
    </main>
  );
}
