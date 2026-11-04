import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import {
  DocumentPane,
  KeyTerms,
  versionLabel
} from '@/components/legal/AgreementParts';
import { Mark } from '@/components/Wordmark';
import { waivernHosted } from '@/lib/hosting';
import { currentDocument, refOf } from '@/lib/legal/documents';
import { PRODUCT_SUFFIX, PRODUCT_VENDOR } from '@/lib/product';
import { getActiveSession } from '@/lib/session';
import { agreementStatus } from '@/services/agreements';

import { signOutAction } from '../welcome/actions';
import { EntityAgreementForm, PersonalTermsForm } from './AgreementForms';

function intro(organisation: string, personal: boolean, entities: boolean) {
  const needed = [
    personal ? 'your own acceptance of its Terms of Service' : null,
    entities
      ? 'each legal entity you work for to accept the terms and a Data Processing Agreement, because Waivern holds its records as its processor'
      : null
  ].filter(Boolean);
  return `Before you work in ${organisation}, Waivern needs ${needed.join(', and ')}. Read the documents in full below. Each acceptance is recorded with the version accepted, the time and the details of the person accepting.`;
}

export const metadata: Metadata = { title: 'Terms and agreements' };

// Whether this is Waivern's hosted service is read when the page is served.
export const dynamic = 'force-dynamic';

/**
 * Where somebody accepts what stands between them and their work: the terms,
 * for themselves, and the terms and the Data Processing Agreement for each
 * legal entity they can see that has not accepted them yet.
 *
 * The session check sends people here; this page asks with the check turned
 * off, and sends them on to their work once nothing is outstanding. It has
 * no masthead link into the app, because nothing there would open.
 */
export default async function AgreementsPage() {
  if (!waivernHosted()) notFound();
  const active = await getActiveSession(undefined, { agreements: 'skip' });
  if (!active) redirect('/sign-in');

  const status = await agreementStatus({
    userId: active.userId,
    organisationId: active.membership.organisationId,
    grants: active.membership.grants
  });
  if (status.clear) redirect('/app');

  const terms = currentDocument('terms');
  const dpa = currentDocument('dpa');
  const forEntities = status.pendingEntities.filter((e) => e.mayAccept);
  const waiting = status.pendingEntities.filter((e) => !e.mayAccept);

  return (
    <main className="mx-auto max-w-3xl space-y-10 px-4 py-10 sm:px-6 sm:py-14">
      <header className="space-y-4">
        <p className="flex items-center gap-3 text-ink">
          <Mark className="h-9 w-9 text-navy" />
          <span className="text-lg font-semibold tracking-tight">
            {PRODUCT_VENDOR}{' '}
            <span className="font-normal text-ink-soft">{PRODUCT_SUFFIX}</span>
          </span>
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          Terms and agreements
        </h1>
        <p className="max-w-prose text-ink-soft">
          {intro(
            active.membership.organisationName,
            !status.termsAccepted,
            status.pendingEntities.length > 0
          )}
        </p>
      </header>

      {!status.termsAccepted ? (
        <section
          aria-labelledby="personal-heading"
          className="space-y-4 rounded border border-line bg-surface p-5"
        >
          <h2
            id="personal-heading"
            className="text-xl font-semibold tracking-tight"
          >
            Your acceptance of the Terms of Service
          </h2>
          <p className="max-w-prose text-sm text-ink-soft">
            Everybody who uses the service accepts the terms for themselves,
            whoever invited them (clause 1.3).
          </p>
          <KeyTerms />
          <DocumentPane doc={terms} />
          <PersonalTermsForm terms={refOf(terms)} />
        </section>
      ) : null}

      {forEntities.length ? (
        <section
          aria-labelledby="entities-heading"
          className="space-y-5 rounded border border-line bg-surface p-5"
        >
          <div className="space-y-1">
            <h2
              id="entities-heading"
              className="text-xl font-semibold tracking-tight"
            >
              Accepting for your legal entities
            </h2>
            <p className="max-w-prose text-sm text-ink-soft">
              As an owner, you can accept the Terms of Service and the Data
              Processing Agreement for the entities below. Only do so if you
              have authority to bind the entity, for example as a director or
              under a delegation from one. Nobody can work in an entity&apos;s
              records until it has accepted.
            </p>
          </div>
          {status.termsAccepted ? <KeyTerms /> : null}
          {status.termsAccepted ? <DocumentPane doc={terms} /> : null}
          <DocumentPane doc={dpa} />
          {forEntities.map((e) => (
            <div
              key={e.id}
              className="space-y-3 border-t border-line pt-4"
            >
              <h3 className="text-base font-semibold">
                {e.name}
                {e.legalEntityRef ? (
                  <span className="ml-2 font-mono text-xs font-normal text-ink-soft">
                    {e.legalEntityRef}
                  </span>
                ) : null}
              </h3>
              <EntityAgreementForm
                entity={e}
                terms={refOf(terms)}
                dpa={refOf(dpa)}
                defaultName={active.name ?? ''}
              />
            </div>
          ))}
        </section>
      ) : null}

      {waiting.length ? (
        <section
          aria-labelledby="waiting-heading"
          className="space-y-3 rounded border border-line bg-surface p-5"
        >
          <h2
            id="waiting-heading"
            className="text-xl font-semibold tracking-tight"
          >
            Waiting for an owner
          </h2>
          <p className="max-w-prose text-sm text-ink-soft">
            These legal entities have not yet accepted the Terms of Service
            (version of {versionLabel(terms.version)}) and the Data Processing
            Agreement (version of {versionLabel(dpa.version)}). Only an owner
            can accept for them. Ask one of the people below; you can carry on
            as soon as they have.
          </p>
          <ul className="divide-y divide-line rounded border border-line text-sm">
            {waiting.map((e) => (
              <li
                key={e.id}
                className="space-y-1 px-4 py-3"
              >
                <p className="font-medium">{e.name}</p>
                <p className="text-ink-soft">
                  {e.owners.length
                    ? e.owners
                        .map((o) =>
                          o.name ? `${o.name} (${o.email})` : o.email
                        )
                        .join(', ')
                    : 'No owner is set for it. Contact Waivern at info@waivern.com.'}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <form action={signOutAction}>
        <button
          type="submit"
          className="rounded border border-line px-3 py-1.5 text-sm hover:border-brand"
        >
          Sign out
        </button>
      </form>

      <p className="text-xs text-ink-soft">
        You can read these documents at any time, and save or print them, from{' '}
        <Link
          href="/legal/terms"
          className="underline underline-offset-2"
        >
          the Terms of Service
        </Link>{' '}
        and{' '}
        <Link
          href="/legal/dpa"
          className="underline underline-offset-2"
        >
          the Data Processing Agreement
        </Link>{' '}
        pages.
      </p>
    </main>
  );
}
