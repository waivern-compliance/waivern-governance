import type { Metadata } from 'next';
import Link from 'next/link';

import { REGIME, REGULATOR } from '@/lib/foi/statutory';
import {
  COMPLAINT_ASKS,
  FIELD_LIMITS,
  openIntakeLink,
  startedToken
} from '@/services/dsr-intake';
import { ENVIRONMENTAL_ASKS, FOI_FIELD_LIMITS } from '@/services/foi-intake';

import { FoiRequestForm } from './FoiRequestForm';
import { FrameResize } from './FrameResize';
import { RequestForm } from './RequestForm';

export const dynamic = 'force-dynamic';

/** The title follows the form: a form switched to requests only does not offer complaints. */
export async function generateMetadata({
  params
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const form = await openIntakeLink((await params).slug);
  return {
    title:
      form?.kind === 'foi'
        ? 'Make a freedom of information request'
        : form?.takesComplaints
          ? 'Make a request or complaint about your personal data'
          : 'Make a request about your personal data',
    robots: { index: false, follow: false }
  };
}

/**
 * The public request form.
 *
 * No session is read and nothing about any request is shown: the address
 * opens the form for one entity, and that is all it does.
 */
export default async function RequestPage({
  params
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const form = await openIntakeLink(slug);

  return (
    <main className="mx-auto max-w-2xl space-y-8 px-6 py-12">
      <FrameResize slug={slug} />
      {form?.kind === 'foi' && form.foiAct ? (
        <>
          <header className="space-y-3 border-b border-line pb-6">
            <h1 className="text-2xl font-semibold tracking-tight">
              Make a freedom of information request
            </h1>
            <p className="max-w-prose text-sm text-ink-soft">
              To {form.controllerName}. Under the {REGIME[form.foiAct].label}{' '}
              anyone can ask for information it holds, for any reason. It must
              normally respond within twenty working days: by sending the
              information, or by explaining why it cannot.
            </p>
            <p className="max-w-prose text-xs text-ink-soft">
              You do not have to use this form. A request by email or by post
              counts just the same, and one for information about the
              environment can also be made by phone or in person. If you are
              unhappy with the response you can ask them to review it, and then
              go to {REGULATOR[form.foiAct]}.
            </p>
          </header>
          <aside className="rounded border border-line bg-surface px-4 py-3 text-sm">
            <p className="font-medium">
              Asking for information about yourself?
            </p>
            <p className="mt-1 text-ink-soft">
              That is a request under data protection law, not freedom of
              information, and it is handled differently.{' '}
              {form.otherFormSlug ? (
                <Link
                  href={`/request/${form.otherFormSlug}`}
                  target="_top"
                  className="text-brand underline"
                >
                  Use the personal data request form
                </Link>
              ) : (
                'Ask them for it by email or post.'
              )}
            </p>
          </aside>
          <FoiRequestForm
            slug={slug}
            started={startedToken(slug)}
            authorityName={form.controllerName}
            limits={FOI_FIELD_LIMITS}
            environmentalAsks={ENVIRONMENTAL_ASKS}
          />
        </>
      ) : form && form.kind === 'data_protection' ? (
        <>
          <header className="space-y-3 border-b border-line pb-6">
            <h1 className="text-2xl font-semibold tracking-tight">
              {form.takesComplaints
                ? 'Make a request or a complaint about your personal data'
                : 'Make a request about your personal data'}
            </h1>
            <p className="max-w-prose text-sm text-ink-soft">
              To {form.controllerName}. Data protection law lets you ask for a
              copy of the personal data an organisation holds about you, have it
              corrected or deleted, or object to how it is used. They must
              normally respond within one month.
              {form.takesComplaints
                ? ' You can also complain to them if you think they have not handled your personal data properly. They must acknowledge a complaint within 30 days, and tell you the outcome.'
                : ''}
            </p>
            <p className="max-w-prose text-xs text-ink-soft">
              You do not have to use this form. A request or complaint by email,
              by post or in person counts just the same.
            </p>
          </header>
          {form.otherFormSlug ? (
            <aside className="rounded border border-line bg-surface px-4 py-3 text-sm">
              <p className="font-medium">
                Asking for other information they hold, not about you?
              </p>
              <p className="mt-1 text-ink-soft">
                That is a freedom of information request.{' '}
                <Link
                  href={`/request/${form.otherFormSlug}`}
                  target="_top"
                  className="text-brand underline"
                >
                  Use the freedom of information form
                </Link>
                .
              </p>
            </aside>
          ) : null}
          <RequestForm
            slug={slug}
            started={startedToken(slug)}
            controllerName={form.controllerName}
            limits={FIELD_LIMITS}
            complaintSubjects={form.takesComplaints ? COMPLAINT_ASKS : null}
          />
        </>
      ) : (
        <section className="space-y-2">
          <h1 className="text-xl font-semibold tracking-tight">
            This form is not taking requests
          </h1>
          <p className="max-w-prose text-sm text-ink-soft">
            The address may be out of date. You can still make a request to the
            organisation by email, by post or in person, and it counts just the
            same.
          </p>
        </section>
      )}
    </main>
  );
}
