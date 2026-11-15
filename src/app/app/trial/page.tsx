import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { ChangeRequestForm } from '@/components/trial/ChangeRequestForm';
import { Colleagues } from '@/components/trial/Colleagues';
import { NextSteps } from '@/components/trial/NextSteps';
import { RequestStatus } from '@/components/trial/RequestStatus';
import { requireSession } from '@/lib/session';
import {
  FICTIONAL_ONLY,
  inRequestWindow,
  REQUEST_WINDOW_HOURS,
  RETENTION_DAYS,
  timeLeft,
  TRIAL_LENGTH,
  TRIAL_REFUSAL
} from '@/lib/trial';
import { trialOfUser } from '@/services/trials';

export const metadata: Metadata = { title: 'Your trial' };

/**
 * What a trial is, how long it has left, and, near its end, where to ask
 * the administrators for more time or a full account.
 */
export default async function TrialPage() {
  const active = await requireSession();
  const trial = active.membership.trial;
  if (!trial) redirect('/app');
  const mine = await trialOfUser(active.userId);
  const now = new Date();
  const opens = new Date(
    trial.endsAt.getTime() - REQUEST_WINDOW_HOURS * 3_600_000
  );
  const canAsk = inRequestWindow(trial.endsAt, now);

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Your trial</h1>
        <p className="text-sm">
          {timeLeft(trial.endsAt, now)} left. It ends on{' '}
          <strong>{trial.endsAt.toUTCString()}</strong>, and then nothing can be
          opened or changed. Only an administrator can extend it.
        </p>
      </header>

      <section className="space-y-1 rounded border border-amber-700 bg-amber-50 p-4 text-sm text-amber-900">
        <h2 className="font-semibold">Fictional data only</h2>
        <p>{FICTIONAL_ONLY}</p>
      </section>

      <Colleagues />

      <section className="space-y-2 text-sm">
        <h2 className="font-semibold">What a trial cannot do</h2>
        <ul className="list-disc space-y-1 pl-5">
          {Object.values(TRIAL_REFUSAL).map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
        <p className="text-ink-soft">
          A trial lasts {TRIAL_LENGTH}. Once it ends, what you entered is kept
          for {RETENTION_DAYS} days in case it is extended or converted, then
          deleted.
        </p>
      </section>

      <RequestStatus
        pending={mine?.pending ?? null}
        lastDecided={mine?.lastDecided ?? null}
      />
      {mine?.pending ? null : canAsk ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">
            Ask for more time or a full account
          </h2>
          <ChangeRequestForm
            organisationName={mine?.trial.organisationName ?? ''}
          />
        </section>
      ) : null}
      {canAsk ? <NextSteps /> : null}
      {mine?.pending || canAsk ? null : (
        <p className="text-sm text-ink-soft">
          In the last {REQUEST_WINDOW_HOURS} hours of your trial, from{' '}
          {opens.toUTCString()}, you can ask the administrators here for more
          time or a full account.
        </p>
      )}
    </main>
  );
}
