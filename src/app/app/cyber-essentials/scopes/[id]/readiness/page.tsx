import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { HelpLink } from '@/components/help/HelpLink';
import { NotPermitted } from '@/components/NotPermitted';
import {
  countsSummary,
  readinessOf,
  SIGN_OFF,
  treatingNow,
  type ReadinessMitigation
} from '@/lib/cyber-essentials/readiness';
import { can } from '@/lib/rbac';
import { SCALES } from '@/lib/risk/scale';
import { getActiveSession } from '@/lib/session';
import {
  cyberEssentialsEnabled,
  loadScope,
  scopeReadiness
} from '@/services/cyber-essentials';
import { candidatesFor } from '@/services/handover';
import { riskScaleOf } from '@/services/risks';

import { ReadinessBadge } from '../../../ReadinessBadge';
import { RaiseRequirementRisk } from './RaiseRequirementRisk';

const MITIGATION_STATUS: Record<ReadinessMitigation['status'], string> = {
  planned: 'planned',
  in_progress: 'in progress',
  implemented: 'implemented, not yet verified',
  verified: 'verified',
  abandoned: 'abandoned'
};

const day = (d: Date) =>
  d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

const ANSWER: Record<string, string> = {
  met: 'yes',
  not_met: 'no',
  not_applicable: 'not applicable'
};

/**
 * A scope's status against each requirement of its edition, read from its
 * latest submitted readiness assessment.
 */
export default async function ScopeReadinessPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const active = await getActiveSession();
  if (!active) redirect('/sign-in');
  const org = active.membership.organisationId;
  if (!(await cyberEssentialsEnabled(org))) redirect('/app/cyber-essentials');
  const loaded = await loadScope(org, id);
  if (!loaded) notFound();
  const { scope } = loaded;
  if (!can(active.membership.grants, 'record.read', scope.entityId))
    return (
      <NotPermitted
        what="This Cyber Essentials scope"
        organisationName={active.membership.organisationName}
      />
    );

  const mayRaise = can(active.membership.grants, 'risk.manage', scope.entityId);
  const [{ submitted, outcomes, treated }, scale, members] = await Promise.all([
    scopeReadiness(org, id),
    riskScaleOf(org),
    mayRaise ? candidatesFor(org) : []
  ]);
  // Read against the edition it was answered for, not the scope's current one.
  const answeredFor = submitted?.edition ?? scope.edition;
  const readiness = readinessOf(answeredFor, outcomes, treated);
  const signOff = submitted && SIGN_OFF[submitted.status];

  return (
    <main className="mx-auto max-w-4xl space-y-8 px-6 py-12">
      <header className="space-y-2 border-b border-line pb-6">
        <Link
          href={`/app/cyber-essentials/scopes/${scope.id}`}
          className="text-xs text-ink-soft hover:text-brand"
        >
          ← {scope.reference} {scope.name}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          Requirement status
        </h1>
        {submitted ? (
          <p className="text-sm text-ink-soft">
            From{' '}
            <Link
              href={`/app/assessments/${submitted.id}`}
              className="text-brand hover:underline"
            >
              {submitted.reference}
            </Link>
            , as submitted on {day(submitted.submittedAt)}
            {submitted.scoreBand ? `: ${submitted.scoreBand}` : ''}
            {signOff ? `, ${signOff}` : ''}. Against requirements {answeredFor}
            {answeredFor !== scope.edition
              ? `; the scope is now prepared against ${scope.edition}, so assess it again`
              : ''}
            .
          </p>
        ) : (
          <p className="text-sm text-ink-soft">
            No readiness assessment of this scope has been submitted yet, so
            nothing is known about any requirement.
          </p>
        )}
      </header>

      <HelpLink topic="cyber-essentials" />

      {readiness.autoFailed ? (
        <p className="rounded border-l-2 border-red-700 bg-red-50 px-4 py-3 text-sm text-red-950">
          <strong>An automatic fail.</strong> A requirement the question set
          fails on outright is not met, so the scope is not ready however few
          others are missed.
        </p>
      ) : null}

      <p className="text-sm text-ink-soft">
        {countsSummary(readiness.counts)}.
      </p>

      {readiness.groups.map((g) => (
        <section
          key={g.id}
          className="space-y-3"
        >
          <h2 className="border-b border-line pb-2 text-lg font-semibold">
            {g.label}
          </h2>
          {g.id === 'scope' ? (
            <p className="max-w-prose text-xs text-ink-soft">
              The scope&apos;s own page checks its placed assets against these
              rules, under Before assessment, whether or not the assessment
              asked about them.
            </p>
          ) : null}
          <ul className="divide-y divide-line rounded border border-line bg-surface">
            {g.rows.map((r) => (
              <li
                key={r.code}
                id={r.code}
                className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-4 py-2.5 text-sm"
              >
                <span className="max-w-prose space-y-0.5">
                  <span className="block">{r.summary}</span>
                  <span className="block font-mono text-[11px] text-ink-soft">
                    <Link
                      href={`/app/cyber-essentials/requirements?edition=${answeredFor}#${r.code}`}
                      className="hover:underline"
                    >
                      {r.code}
                    </Link>
                    , page {r.page}
                    {r.autoFail ? ' · automatic fail' : ''}
                  </span>
                  {r.questions.map((q) => (
                    <span
                      key={q.key}
                      className="block text-xs text-ink-soft"
                    >
                      {q.label}{' '}
                      <strong>
                        {q.answer ? ANSWER[q.answer] : 'unanswered'}
                      </strong>
                    </span>
                  ))}
                  {r.mitigations.map((m) => (
                    <span
                      key={m.mitigationId}
                      className="block text-xs"
                    >
                      {m.status === 'verified' ? (
                        <strong className="text-emerald-900">Evidence: </strong>
                      ) : null}
                      <Link
                        href={`/app/risks/${m.riskId}`}
                        className="font-mono text-ink-soft hover:text-brand"
                      >
                        {m.riskReference}
                      </Link>{' '}
                      {m.description}{' '}
                      <span className="text-ink-soft">
                        ({MITIGATION_STATUS[m.status]}
                        {m.verifiedAt ? ` ${day(m.verifiedAt)}` : ''}
                        {m.status !== 'verified' && m.dueAt
                          ? `, due ${day(m.dueAt)}`
                          : ''}
                        )
                      </span>
                    </span>
                  ))}
                </span>
                <ReadinessBadge status={r.status} />
                {r.status === 'not_met' &&
                submitted &&
                mayRaise &&
                !treatingNow(r.mitigations, r.code) ? (
                  <RaiseRequirementRisk
                    scopeId={scope.id}
                    code={r.code}
                    title={`Not in place for ${scope.reference}: ${r.summary}`}
                    description={`${submitted.reference} found this requirement not met for ${scope.reference} ${scope.name}. Until it is, devices in the scope are open to the common internet attacks Cyber Essentials guards against.`}
                    mitigation={`Put in place: ${r.summary}`}
                    likelihood={SCALES[scale].likelihood}
                    impact={SCALES[scale].impact}
                    members={members}
                    viewerId={active.userId}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
