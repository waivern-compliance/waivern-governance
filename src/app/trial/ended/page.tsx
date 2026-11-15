import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { ChangeRequestForm } from '@/components/trial/ChangeRequestForm';
import { NextSteps } from '@/components/trial/NextSteps';
import { RequestStatus } from '@/components/trial/RequestStatus';
import { Mark } from '@/components/Wordmark';
import { hasEnded, RETENTION_DAYS, TRIAL_LENGTH } from '@/lib/trial';
import { trialOfUser } from '@/services/trials';

import { signOutOfTrialAction } from '../actions';

export const metadata: Metadata = { title: 'Your trial has ended' };

export const dynamic = 'force-dynamic';

const DAY = 86_400_000;

/**
 * Where every page and action sends a trial whose time is up
 * (`getActiveSession`). It reads the person's trial itself, since nothing
 * that goes through the session would open.
 */
export default async function TrialEnded() {
  const session = await auth();
  if (!session?.user?.id) redirect('/trial');
  const mine = await trialOfUser(session.user.id);
  if (!mine) redirect('/sign-in');
  const { trial, pending, lastDecided } = mine;
  if (trial.status === 'converted' || !hasEnded(trial.endsAt)) redirect('/app');

  const deletedFrom = new Date(trial.endsAt.getTime() + RETENTION_DAYS * DAY);
  return (
    <main className="mx-auto flex min-h-full max-w-lg flex-col justify-center gap-6 px-6 py-12">
      <header className="space-y-3">
        <Mark className="h-12 w-12 text-navy" />
        <h1 className="text-2xl font-semibold tracking-tight">
          Your trial has ended
        </h1>
        <p className="text-sm">
          A trial runs for {TRIAL_LENGTH}, and yours ended on{' '}
          {trial.endsAt.toUTCString()}. Nothing can be opened or changed now,
          and only an administrator can extend it.
        </p>
        <p className="text-sm text-ink-soft">
          What you entered is kept until {deletedFrom.toUTCString()}, so it can
          carry on if your trial is extended or becomes a full account. After
          that it is deleted.
        </p>
      </header>

      <RequestStatus
        pending={pending}
        lastDecided={lastDecided}
      />
      {pending ? null : (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">
            Ask for more time or a full account
          </h2>
          <ChangeRequestForm organisationName={trial.organisationName ?? ''} />
        </section>
      )}

      <NextSteps />

      <form action={signOutOfTrialAction}>
        <button
          type="submit"
          className="text-sm text-ink-soft underline hover:text-brand"
        >
          Sign out
        </button>
      </form>
    </main>
  );
}
