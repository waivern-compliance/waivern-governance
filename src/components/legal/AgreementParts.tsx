import Link from 'next/link';

import {
  documentPath,
  KEY_TERMS,
  type DocumentRef,
  type LegalDocument
} from '@/lib/legal/shared';

import { LegalText } from './LegalText';

/** "9 November 2026", from a version's date. */
export function versionLabel(version: string): string {
  return new Date(`${version}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  });
}

/**
 * The terms that limit what the customer can claim, set out before the boxes
 * are ticked. A summary only; the terms themselves say what applies.
 */
export function KeyTerms() {
  return (
    <section
      aria-labelledby="key-terms-heading"
      className="space-y-2 rounded border border-amber-300 bg-amber-50 p-4 text-sm text-ink"
    >
      <h3
        id="key-terms-heading"
        className="font-semibold"
      >
        Before you accept, note in particular
      </h3>
      <ul className="list-disc space-y-1 pl-5">
        {KEY_TERMS.map((t) => (
          <li key={t.clause}>
            {t.text}{' '}
            <span className="whitespace-nowrap text-ink-soft">
              (clause {t.clause})
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-ink-soft">
        This is a summary to help you find the terms that matter most. It does
        not change them: the Terms of Service below are what apply.
      </p>
    </section>
  );
}

/**
 * The whole of a document, scrollable in place, with a way to open it on its
 * own page to save or print. Shown in full rather than behind a link, so the
 * text was in front of the person when they accepted it.
 */
export function DocumentPane({ doc }: { doc: LegalDocument }) {
  const headingId = `${doc.kind}-pane-heading`;
  return (
    <section
      aria-labelledby={headingId}
      className="space-y-2"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3
          id={headingId}
          className="text-sm font-semibold"
        >
          {doc.title}{' '}
          <span className="font-normal text-ink-soft">
            (version of {versionLabel(doc.version)})
          </span>
        </h3>
        <Link
          href={documentPath(doc)}
          target="_blank"
          className="text-xs text-brand underline underline-offset-2"
        >
          Open in a new tab to save or print
        </Link>
      </div>
      <div
        tabIndex={0}
        role="region"
        aria-label={`${doc.title}, full text`}
        className="max-h-96 overflow-y-auto rounded border border-line bg-ground p-4 focus-visible:outline-2 focus-visible:outline-brand"
      >
        <LegalText
          body={doc.body}
          nested
        />
      </div>
    </section>
  );
}

const check = 'mt-0.5 h-4 w-4 shrink-0 accent-brand';
const field =
  'w-full rounded border border-line bg-ground px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-brand';
const fieldLabel =
  'block text-xs font-medium uppercase tracking-wider text-ink-soft';

/**
 * What the person binding an entity ticks and types. The boxes start empty and
 * each says one thing, so ticking one is a deliberate statement of that thing
 * and nothing else. The versions travel with the form, so an acceptance is
 * recorded only against the text that was on the screen.
 */
export function EntityAgreementFields({
  entityName,
  terms,
  dpa,
  defaultName,
  idPrefix
}: {
  entityName: string;
  terms: DocumentRef;
  dpa: DocumentRef;
  defaultName: string;
  idPrefix: string;
}) {
  return (
    <fieldset className="space-y-3">
      <legend className="sr-only">Accepting for {entityName}</legend>
      <input
        type="hidden"
        name="termsVersion"
        value={terms.version}
      />
      <input
        type="hidden"
        name="dpaVersion"
        value={dpa.version}
      />
      <label className="flex gap-2 text-sm">
        <input
          type="checkbox"
          name="acceptTerms"
          required
          className={check}
        />
        <span>
          I have read the {terms.title} (version of{' '}
          {versionLabel(terms.version)}) and accept them on behalf of{' '}
          <strong>{entityName}</strong>.
        </span>
      </label>
      <label className="flex gap-2 text-sm">
        <input
          type="checkbox"
          name="acceptDpa"
          required
          className={check}
        />
        <span>
          I have read the {dpa.title} (version of {versionLabel(dpa.version)})
          and accept it on behalf of <strong>{entityName}</strong>, as
          controller, with Waivern Limited as its processor.
        </span>
      </label>
      <label className="flex gap-2 text-sm">
        <input
          type="checkbox"
          name="confirmAuthority"
          required
          className={check}
        />
        <span>
          I confirm that I have authority to enter into these agreements for{' '}
          <strong>{entityName}</strong> and to bind it to them.
        </span>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label
          className="block space-y-1"
          htmlFor={`${idPrefix}-name`}
        >
          <span className={fieldLabel}>Your full name</span>
          <input
            id={`${idPrefix}-name`}
            name="signatoryName"
            required
            minLength={2}
            maxLength={120}
            autoComplete="name"
            defaultValue={defaultName}
            className={field}
          />
        </label>
        <label
          className="block space-y-1"
          htmlFor={`${idPrefix}-position`}
        >
          <span className={fieldLabel}>Your position</span>
          <input
            id={`${idPrefix}-position`}
            name="signatoryPosition"
            required
            minLength={2}
            maxLength={120}
            autoComplete="organization-title"
            placeholder="Director, Data Protection Officer…"
            className={field}
          />
        </label>
      </div>
    </fieldset>
  );
}
