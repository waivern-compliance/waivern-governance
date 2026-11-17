import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { AssessmentForm } from '@/components/AssessmentForm';
import { Chat } from '@/components/assistant/Chat';
import { Discussion } from '@/components/Discussion';
import { Attachments } from '@/components/documents/Attachments';
import { ConfirmImported } from '@/components/imports/ConfirmImported';
import { ImportedFrom } from '@/components/imports/ImportedFrom';
import { NotPermitted } from '@/components/NotPermitted';
import { RaiseRiskForm } from '@/components/RaiseRiskForm';
import { RiskTierBadge } from '@/components/RiskTierBadge';
import { TrialNotice } from '@/components/trial/TrialNotice';
import { categoryLabel } from '@/lib/ai-frameworks';
import { legalRefMap } from '@/lib/legal-refs';
import {
  can,
  mayDecideStage,
  ROLE_LABEL,
  rolesOn,
  type AppRole
} from '@/lib/rbac';
import { SCALES } from '@/lib/risk/scale';
import { getActiveSession } from '@/lib/session';
import { aiFrameworkPackOf } from '@/services/ai-framework';
import {
  assessmentHistory,
  loadAssessment,
  type LoadedAssessment
} from '@/services/assessments';
import { providerFor } from '@/services/assistant';
import { linksForAssessment } from '@/services/contributor-links';
import { documentsFor } from '@/services/documents';
import { importSourceName } from '@/services/imports';
import { riskScaleOf, risksForAssessment } from '@/services/risks';
import { approvalsFor } from '@/services/workflow';

import { saveAction, submitAction } from './actions';
import { Approvals } from './approvals';
import { InviteContributor } from './invite';

const EDITABLE = ['draft', 'in_progress', 'returned'];

export default async function AssessmentPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const active = await getActiveSession();
  if (!active) redirect('/sign-in');

  const loaded = await loadAssessment(id, active.membership.organisationId);
  if (!loaded) notFound();

  const { assessment, definition, templateName, answers, answerMeta } = loaded;

  const configured = await providerFor(active.membership.organisationId);
  const assistant = configured?.surfaces.includes('assessment') ?? false;
  /**
   * Deliberately the questions and not the answers. The questions are template
   * text the organisation already published; the answers are where somebody
   * may have written about a real person.
   */
  const assistantContext = [
    `Assessment ${assessment.reference}, from the template "${templateName}".`,
    "These are its questions. The user's answers are not included.",
    ...definition.schema.sections.flatMap((section) => [
      `Section: ${section.title}`,
      ...section.questions.map(
        (q) => `- ${q.label}${q.help ? ` - ${q.help}` : ''}`
      )
    ])
  ].join('\n');

  // Entity scoping was being enforced on every list and ignored here, so an
  // assessment could be read by anyone in the organisation who had its id.
  // Reading it requires either the right to read records in its entity, or the
  // right to answer in that entity — which is what an assigned contributor has.
  const mayOpen =
    can(active.membership.grants, 'record.read', assessment.entityId) ||
    can(active.membership.grants, 'assessment.answer', assessment.entityId);
  if (!mayOpen) {
    return (
      <NotPermitted
        what={`${assessment.reference} belongs to another part of the organisation, and`}
        organisationName={active.membership.organisationName}
      />
    );
  }
  const [refs, history, links, gates, raised, scale, framework] =
    await Promise.all([
      legalRefMap(),
      assessmentHistory(id),
      linksForAssessment(id),
      approvalsFor(id),
      risksForAssessment(id, active.membership.organisationId),
      riskScaleOf(active.membership.organisationId),
      aiFrameworkPackOf(active.membership.organisationId)
    ]);
  const mayRaise = can(
    active.membership.grants,
    'risk.manage',
    assessment.entityId
  );
  // What the assessor said belongs on the register, offered first when raising.
  const named = Array.isArray(answers.risk_categories)
    ? (answers.risk_categories as string[]).filter((c) => c !== 'none')
    : [];
  const unraised = named.filter((c) => !raised.some((r) => r.category === c));

  // The first pending gate is the only one that can be decided now, and only
  // by somebody holding its role in this assessment's entity, or an owner.
  const nextGate = gates.find((g) => g.status === 'pending') ?? null;
  const mayDecideHere =
    nextGate !== null &&
    mayDecideStage(
      rolesOn(active.membership.grants, assessment.entityId),
      nextGate.requiredRole
    );

  const editable =
    EDITABLE.includes(assessment.status) &&
    can(active.membership.grants, 'assessment.answer', assessment.entityId);
  const maySubmit = can(
    active.membership.grants,
    'assessment.submit',
    assessment.entityId
  );

  const meta = Object.fromEntries(
    Object.entries(answerMeta).map(([k, v]) => [
      k,
      { by: v.by, at: v.at.toISOString().slice(0, 16).replace('T', ' ') }
    ])
  );

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-6 py-12">
      <header className="space-y-2 border-b border-line pb-6">
        <Link
          href="/app/assessments"
          className="text-xs text-ink-soft hover:text-brand"
        >
          ← Assessments
        </Link>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-mono text-sm text-ink-soft">
            {assessment.reference}
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">
            {assessment.title}
          </h1>
        </div>
        <p className="font-mono text-xs text-ink-soft">
          {templateName} · {assessment.status.replace(/_/g, ' ')}
          {assessment.scoreBand
            ? ` · ${assessment.scoreBand} (${assessment.scoreValue})`
            : ''}
        </p>
      </header>

      {assessment.importSourceId ? (
        <ImportedAssessment
          sourceName={
            (await importSourceName(
              active.membership.organisationId,
              assessment.importSourceId
            )) ?? 'another platform'
          }
          assessment={assessment}
          files={await documentsFor(
            active.membership.organisationId,
            'assessment',
            id
          )}
          confirm={
            can(
              active.membership.grants,
              'record.write',
              assessment.entityId
            ) ? (
              <ConfirmImported
                type="assessment"
                id={id}
                revalidate={`/app/assessments/${id}`}
                what="this assessment"
              />
            ) : null
          }
        />
      ) : (
        <>
          <AssessmentForm
            definition={definition}
            initialAnswers={answers}
            readOnly={!editable}
            legalRefs={refs}
            law={loaded.entityLaw}
            answerMeta={meta}
            onSave={saveAction.bind(null, id)}
            onFinish={
              editable && maySubmit ? submitAction.bind(null, id) : undefined
            }
          />

          {editable &&
          !can(
            active.membership.grants,
            'contact.outside',
            assessment.entityId
          ) ? (
            <TrialNotice
              withheld="contact.outside"
              what="Contributors"
            />
          ) : editable ? (
            <InviteContributor
              assessmentId={id}
              sections={definition.schema.sections
                .filter((s) => !s.organisationOnly)
                .map((s) => ({
                  key: s.key,
                  title: s.title
                }))}
              existing={links.map((l) => ({
                id: l.id,
                email: l.email,
                sectionKey: l.sectionKey,
                useCount: l.useCount,
                completedAt: l.completedAt?.toISOString().slice(0, 10) ?? null,
                revokedAt: l.revokedAt?.toISOString().slice(0, 10) ?? null,
                expiresAt: l.expiresAt.toISOString().slice(0, 10)
              }))}
            />
          ) : null}

          {active.membership.trial ? (
            <p className="max-w-prose rounded border border-dashed border-amber-700 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              In a trial, the people these stages go to are simulated
              colleagues, told in the app and never by email. Decide each stage
              yourself to see what happens next.
            </p>
          ) : null}
          <Approvals
            assessmentId={id}
            gates={gates.map((g) => ({
              id: g.id,
              position: g.position,
              name: g.name,
              requiredRole: g.requiredRole,
              status: g.status,
              reason: g.reason,
              decidedBy: g.decidedByLabel,
              decidedAt: g.decidedAt?.toISOString().slice(0, 10) ?? null,
              rationale: g.rationale,
              boardName: g.boardName,
              boardReference: g.boardReference
            }))}
            decidableId={nextGate && mayDecideHere ? nextGate.id : null}
            notYours={
              // The stage waiting now, when this viewer cannot decide it. Without
              // this the form simply does not appear, and an owner who expected to
              // act reads the missing buttons as the platform being broken.
              nextGate && !mayDecideHere
                ? {
                    gateId: nextGate.id,
                    roleLabel:
                      ROLE_LABEL[nextGate.requiredRole as AppRole] ??
                      nextGate.requiredRole,
                    mayGrant: can(active.membership.grants, 'member.manage')
                  }
                : null
            }
          />
        </>
      )}

      {raised.length > 0 || mayRaise || named.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-soft">
            Risks from this assessment
          </h2>
          {unraised.length > 0 ? (
            <p className="rounded border-l-2 border-amber-700 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              <strong>Not on the register yet:</strong>{' '}
              {unraised.map((c) => categoryLabel(c)).join(', ')}. The assessment
              says these carry risk; until each is raised, nothing scores it,
              treats it or judges it against appetite.
            </p>
          ) : null}
          {raised.length > 0 ? (
            <ul className="divide-y divide-line overflow-hidden rounded border border-line bg-surface">
              {raised.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/app/risks/${r.id}`}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2.5 text-sm hover:bg-ground"
                  >
                    <span>
                      <span className="font-mono text-xs text-ink-soft">
                        {r.reference}
                      </span>{' '}
                      {r.title}
                      {r.category ? (
                        <span className="text-xs text-ink-soft">
                          {' '}
                          · {categoryLabel(r.category)}
                        </span>
                      ) : null}
                    </span>
                    <span className="flex items-center gap-2">
                      <RiskTierBadge
                        tier={r.inherentTier}
                        score={r.inherentScore}
                        prefix="inherent"
                      />
                      <RiskTierBadge
                        tier={r.residualTier}
                        score={r.residualScore}
                        prefix="residual"
                      />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          {mayRaise ? (
            <details className="rounded border border-line bg-surface">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
                Raise a risk from this assessment
              </summary>
              <RaiseRiskForm
                entities={[{ id: assessment.entityId, name: '' }]}
                assessmentId={id}
                suggestedCategories={unraised.length > 0 ? unraised : named}
                categories={framework.categories}
                likelihood={SCALES[scale].likelihood}
                impact={SCALES[scale].impact}
              />
            </details>
          ) : null}
        </section>
      ) : null}

      {history.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-soft">
            History
          </h2>
          <ul className="divide-y divide-line overflow-hidden rounded border border-line bg-surface">
            {history.map((r) => (
              <li
                key={r.id}
                className="flex items-baseline justify-between px-4 py-2.5 text-sm"
              >
                <span>
                  <span className="font-mono text-xs text-ink-soft">
                    r{r.revision}
                  </span>{' '}
                  {r.reason}
                </span>
                <span className="font-mono text-xs text-ink-soft">
                  {r.createdByLabel} · {r.createdAt.toISOString().slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* An imported assessment has no questions here to be stuck on. */}
      {assistant && !assessment.importSourceId ? (
        <section className="space-y-2 rounded border border-line bg-surface p-4">
          <h2 className="text-sm font-semibold">Stuck on a question?</h2>
          <Chat
            surface="assessment"
            subjectType="assessment"
            subjectId={id}
            entityId={assessment.entityId}
            contextText={assistantContext}
            invitation="It has been given this assessment's questions, not your answers. It will explain what one is asking, or draft wording for you to edit - it cannot fill anything in for you."
            placeholder="What counts as special category data here?"
          />
        </section>
      ) : null}

      <Discussion
        subjectType="assessment"
        subjectId={id}
        entityId={assessment.entityId}
        subjectLabel={assessment.reference}
      />
    </main>
  );
}

/**
 * An assessment done in another platform: where it came from, what that
 * platform recorded of its outcome, and its questions and answers as that
 * platform asked them. Read only; a reassessment is started here as new.
 */
function ImportedAssessment({
  sourceName,
  assessment,
  files,
  confirm
}: {
  sourceName: string;
  assessment: LoadedAssessment['assessment'];
  files: Awaited<ReturnType<typeof documentsFor>>;
  confirm: React.ReactNode;
}) {
  const waiting = assessment.importConfirmedAt === null;
  const answers = assessment.sourceAnswers ?? [];
  return (
    <>
      <ImportedFrom
        sourceName={sourceName}
        batchId={assessment.importBatchId}
        confirmed={!waiting}
        legacy={assessment.legacy}
        history={assessment.sourceHistory}
        confirm={confirm}
      />
      {waiting && assessment.importedOutcome === 'approved' ? (
        <p className="max-w-prose text-xs text-amber-900">
          Approved in {sourceName}. Until it is confirmed here, it does not
          count as an approved assessment: what it assessed still shows the gap.
        </p>
      ) : null}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-soft">
          As {sourceName} asked it
        </h2>
        <p className="max-w-prose text-xs text-ink-soft">
          Its questions were {sourceName}&rsquo;s, so it is kept as it was
          answered there and cannot be edited here. To assess this again, start
          a new assessment.
        </p>
        {answers.length > 0 ? (
          <dl className="divide-y divide-line overflow-hidden rounded border border-line bg-surface text-sm">
            {answers.map((a, i) => (
              <div
                key={i}
                className="space-y-1 px-4 py-3"
              >
                <dt className="font-medium">{a.question}</dt>
                <dd className="whitespace-pre-wrap break-words text-ink-soft">
                  {a.answer}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-ink-soft">
            No answers came with it. Any report attached below is the record.
          </p>
        )}
      </section>
      <Attachments
        subjectType="assessment"
        subjectId={assessment.id}
        entityId={assessment.entityId}
        revalidate={`/app/assessments/${assessment.id}`}
        documents={files}
        mayEdit={false}
        what={`The report from ${sourceName}`}
      />
    </>
  );
}
