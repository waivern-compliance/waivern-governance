import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CheckList } from '@/components/site/CheckList';
import { PublicHeader } from '@/components/site/PublicHeader';
import { waivernHosted } from '@/lib/hosting';
import {
  LINK_MINUTES,
  REQUEST_WINDOW_HOURS,
  TRIAL_LENGTH,
  trialsOpen
} from '@/lib/trial';
import { signUpStarted } from '@/services/trials';

import { SignUpForm } from './SignUpForm';

export const metadata: Metadata = { title: 'Try it free' };

// Whether trials are open, and when the form was opened, are read per request.
export const dynamic = 'force-dynamic';

/**
 * Ask for a trial. Also where somebody already trying it asks for a new link
 * to sign back in: the same form, the same answer.
 */
export default function TrialSignUp() {
  if (!trialsOpen()) notFound();
  const hosted = waivernHosted();
  return (
    <div>
      <PublicHeader
        action={
          <Link
            href="/sign-in"
            className="text-sm text-ink-soft hover:text-brand"
          >
            Sign in
          </Link>
        }
      />
      <main className="mx-auto max-w-xl space-y-6 px-4 py-10 sm:px-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-navy">
            Try it free for {TRIAL_LENGTH}
          </h1>
          <p className="text-sm text-ink-soft">
            We send a link that works once, for {LINK_MINUTES} minutes. Open it
            and you have an organisation of your own for {TRIAL_LENGTH}, already
            filled in as a fictional demo company with simulated colleagues, so
            you can see the work flow end to end. Already trying it? Ask here
            for a new link to sign back in.
          </p>
        </header>

        <SignUpForm started={signUpStarted()} />

        <section className="space-y-2 text-sm">
          <h2 className="font-semibold">What a trial can and cannot do</h2>
          <CheckList
            className="space-y-1.5"
            items={[
              'A demo company to explore: processing activities, a breach with its clock running, an AI system with risks, suppliers with gaps, a request and a complaint',
              'The full approval loop, with simulated colleagues who are told in the app and never by email',
              'Text only: your own files cannot be uploaded, but built-in example files can be attached in one click',
              'Reaches nobody: no invitations, links, public forms or emails to anyone else, and no outside services such as an AI provider',
              `${TRIAL_LENGTH}, then it stops. In the last ${REQUEST_WINDOW_HOURS} hours you can ask for more time or a full account; an administrator decides`
            ]}
          />
          {hosted ? (
            <p className="text-ink-soft">
              Before you start you accept the{' '}
              <Link
                href="/legal/terms"
                className="text-brand underline"
              >
                Terms of Service
              </Link>{' '}
              and the{' '}
              <Link
                href="/legal/dpa"
                className="text-brand underline"
              >
                Data Processing Agreement
              </Link>
              , as every owner does.
            </p>
          ) : null}
        </section>
      </main>
    </div>
  );
}
