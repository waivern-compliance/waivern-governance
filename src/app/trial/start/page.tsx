import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { Mark } from '@/components/Wordmark';
import { TRIAL_LENGTH, trialsOpen } from '@/lib/trial';

import { StartLanding } from './StartLanding';

export const metadata: Metadata = { title: 'Your trial' };

export const dynamic = 'force-dynamic';

/** Where the emailed link lands. */
export default function TrialStart() {
  if (!trialsOpen()) notFound();
  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col justify-center gap-6 px-6 py-12">
      <header className="space-y-3">
        <Mark className="h-12 w-12 text-navy" />
        <h1 className="text-2xl font-semibold tracking-tight">Your trial</h1>
        <p className="text-sm text-ink-soft">
          A new trial runs for {TRIAL_LENGTH} from the moment you continue. If
          you already have one, this signs you back in to it.
        </p>
      </header>
      <StartLanding />
    </main>
  );
}
