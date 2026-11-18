import Link from 'next/link';
import { redirect } from 'next/navigation';

import { HelpLink } from '@/components/help/HelpLink';
import { NotPermitted } from '@/components/NotPermitted';
import { formatControlRef } from '@/lib/cyber-essentials/control-ref';
import { changedBetween } from '@/lib/cyber-essentials/crosswalk';
import {
  CE_EDITIONS,
  CE_PLUS_SPECIFICATION_URL,
  ceEdition,
  editionInForce,
  isAutoFail,
  requirementsOf,
  scopeRulesOf
} from '@/lib/cyber-essentials/editions';
import {
  CLOUD_MODEL_LABEL,
  DEVICE_CLASS_LABEL,
  IMPLEMENTER_LABEL
} from '@/lib/cyber-essentials/labels';
import { CE_THEMES } from '@/lib/cyber-essentials/requirements';
import type {
  CeCloudModel,
  CeEditionId,
  CeScopeRule
} from '@/lib/cyber-essentials/types';
import { can } from '@/lib/rbac';
import { getActiveSession } from '@/lib/session';

const CLOUD_MODELS: readonly CeCloudModel[] = ['iaas', 'paas', 'saas'];

const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  });

const isEditionId = (v: unknown): v is CeEditionId =>
  CE_EDITIONS.some((e) => e.id === v);

/**
 * The Cyber Essentials requirements, by edition: reference, not a record.
 *
 * Shown to every organisation, whether or not it certifies, because the same
 * requirements are what an organisation asks of a supplier that holds the
 * certificate.
 */
export default async function CyberEssentialsRequirementsPage({
  searchParams
}: {
  searchParams: Promise<{ edition?: string }>;
}) {
  const active = await getActiveSession();
  if (!active) redirect('/sign-in');
  if (!can(active.membership.grants, 'record.read')) {
    return (
      <NotPermitted
        what="Cyber Essentials requirements"
        organisationName={active.membership.organisationName}
      />
    );
  }

  const current = editionInForce(new Date());
  const { edition: raw } = await searchParams;
  const edition = ceEdition(isEditionId(raw) ? raw : current.id);
  const previous = CE_EDITIONS[CE_EDITIONS.indexOf(edition) - 1];
  const requirements = requirementsOf(edition.id);
  const rules = scopeRulesOf(edition.id);

  return (
    <main className="mx-auto max-w-5xl space-y-8 px-6 py-12">
      <header className="space-y-2 border-b border-line pb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          Cyber Essentials requirements
        </h1>
        <p className="max-w-prose text-sm text-ink-soft">
          The five technical controls a Cyber Essentials certificate is assessed
          against, and the rules for what its scope must include, in
          Govern&rsquo;s words with the page of NCSC&rsquo;s document each comes
          from. Cyber Essentials is a government-backed certification scheme,
          not a legal duty: an organisation takes it up, or a contract asks for
          it.
        </p>
      </header>

      <HelpLink topic="cyber-essentials" />

      <nav
        className="flex flex-wrap gap-2 text-sm"
        aria-label="Edition"
      >
        {CE_EDITIONS.map((e) => (
          <Link
            key={e.id}
            href={
              e.id === current.id
                ? '/app/cyber-essentials/requirements'
                : `/app/cyber-essentials/requirements?edition=${e.id}`
            }
            aria-current={e.id === edition.id ? 'page' : undefined}
            className={`rounded border px-3 py-1.5 ${e.id === edition.id ? 'border-brand text-brand' : 'border-line hover:border-brand'}`}
          >
            {e.id} ({e.questionSet}){e.id === current.id ? ' · current' : ''}
          </Link>
        ))}
      </nav>

      <section className="space-y-1 text-sm">
        <p>
          Requirements for IT Infrastructure {edition.id}, assessed with
          IASME&rsquo;s {edition.questionSet} question set, for assessments
          started from {longDate(edition.effectiveFrom)}. Cyber Essentials Plus
          is tested against NCSC&rsquo;s test specification{' '}
          {edition.plusSpecification}.
        </p>
        <p className="flex flex-wrap gap-4 text-xs">
          <a
            href={edition.requirementsUrl}
            className="text-brand hover:underline"
          >
            NCSC requirements {edition.id} (PDF) ↗
          </a>
          <a
            href={CE_PLUS_SPECIFICATION_URL}
            className="text-brand hover:underline"
          >
            Plus test specification {edition.plusSpecification} (PDF) ↗
          </a>
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="border-b border-line pb-2 text-lg font-semibold">
          Scope
        </h2>
        <ul className="divide-y divide-line rounded border border-line bg-surface">
          {rules.map((r) => (
            <ScopeRow
              key={r.code}
              rule={r}
              edition={edition.id}
              changed={
                previous !== undefined &&
                changedBetween(r.code, previous.id, edition.id)
              }
            />
          ))}
        </ul>
      </section>

      {CE_THEMES.map((theme) => (
        <section
          key={theme.id}
          className="space-y-3"
        >
          <h2 className="border-b border-line pb-2 text-lg font-semibold">
            {theme.label}
          </h2>
          <p className="max-w-prose text-sm">{theme.aim}</p>
          <p className="text-xs text-ink-soft">
            Applies to{' '}
            {theme.appliesTo.map((c) => DEVICE_CLASS_LABEL[c]).join(', ')}.
          </p>
          <dl className="grid gap-2 text-xs sm:grid-cols-3">
            {CLOUD_MODELS.map((m) => (
              <div
                key={m}
                className="rounded border border-line px-3 py-2"
              >
                <dt className="text-ink-soft">{CLOUD_MODEL_LABEL[m]}</dt>
                <dd>{IMPLEMENTER_LABEL[theme.cloud[m]]}</dd>
              </div>
            ))}
          </dl>
          <ul className="divide-y divide-line rounded border border-line bg-surface">
            {requirements
              .filter((r) => r.theme === theme.id)
              .map((r) => (
                <li
                  key={r.code}
                  id={r.code}
                  className="scroll-mt-6 space-y-1 px-4 py-3"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="max-w-prose text-sm">{r.summary}</p>
                    {isAutoFail(edition.id, r.code) ? (
                      <span className="rounded border border-amber-700 bg-amber-50 px-2 py-0.5 font-mono text-[11px] text-amber-900">
                        automatic fail
                      </span>
                    ) : null}
                  </div>
                  <p className="font-mono text-[11px] text-ink-soft">
                    {formatControlRef(edition.id, r.code)} · page{' '}
                    {r.pages[edition.id]}
                  </p>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </main>
  );
}

function ScopeRow({
  rule,
  edition,
  changed
}: {
  rule: CeScopeRule;
  edition: CeEditionId;
  changed: boolean;
}) {
  return (
    <li
      id={rule.code}
      className="scroll-mt-6 space-y-1 px-4 py-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="max-w-prose text-sm">
          {rule.earlier?.[edition] ?? rule.summary}
        </p>
        {changed ? (
          <span className="rounded border border-line px-2 py-0.5 font-mono text-[11px] text-ink-soft">
            changed in {edition}
          </span>
        ) : null}
      </div>
      <p className="font-mono text-[11px] text-ink-soft">
        {rule.code} · page {rule.pages[edition]}
      </p>
    </li>
  );
}
