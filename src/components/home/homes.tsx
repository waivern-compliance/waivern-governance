import Link from 'next/link';

import { navFor } from '@/lib/nav';
import { statusWords, type Persona } from '@/lib/persona';
import { actingAs, can } from '@/lib/rbac';
import type { ActiveSession } from '@/lib/session';
import { visibleEntityIds } from '@/lib/session';
import { listIncidents } from '@/services/ai-incidents';
import { nistProfileTally } from '@/services/ai-profile';
import {
  GAP_WORDS,
  registerSummary,
  SERIOUS_GAPS,
  STAGE_LABEL,
  type LifecycleStage
} from '@/services/ai-register';
import { dashboardMetrics } from '@/services/metrics';
import type { ProgrammeScope } from '@/services/programme-scope';

import { aiEstate, myAssessments, myMitigations, myTasks } from './data';
import { dueWords, Empty, Panel, Row, Rows, Tile, Tiles } from './parts';

const taskHref: Record<string, (id: string) => string> = {
  assessment: (id) => `/app/assessments/${id}`,
  risk: (id) => `/app/risks/${id}`,
  mitigation: () => '/app/risks'
};

function hrefFor(subjectType: string, subjectId: string) {
  return taskHref[subjectType]?.(subjectId) ?? '/app';
}

/** Tasks, rendered the same way wherever they appear. */
async function TaskPanel({
  active,
  title,
  hint,
  empty,
  persona
}: {
  active: ActiveSession;
  title: string;
  hint?: string;
  empty: string;
  persona: Persona;
}) {
  const tasks = await myTasks(active);
  const mine = tasks.filter(
    (t) =>
      t.assigneeUserId === active.userId ||
      (t.assigneeRole &&
        actingAs(active.membership.grants.map((g) => g.role)).includes(
          t.assigneeRole
        ))
  );
  const shown = mine.length > 0 ? mine : tasks;

  return (
    <Panel
      title={title}
      hint={hint}
      action={{ href: '/app/tasks', label: 'All tasks' }}
    >
      {shown.length === 0 ? (
        <Empty>{empty}</Empty>
      ) : (
        <Rows>
          {shown.slice(0, 6).map((t) => {
            const due = dueWords(t.dueAt);
            return (
              <Row
                key={t.id}
                href={hrefFor(t.subjectType, t.subjectId)}
                title={t.title}
                detail={t.description}
                meta={t.breachedAt ? `overdue · ${due.text}` : due.text}
                tone={t.breachedAt ? 'stop' : due.tone}
              />
            );
          })}
        </Rows>
      )}
      {persona === 'product' || persona === 'engineering' ? null : (
        <p className="text-xs text-ink-soft">
          {tasks.length} open across everything you can see.
        </p>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ */

/** Privacy governance: the programme, and what needs a person. */
export async function PrivacyHome({
  active,
  scope
}: {
  active: ActiveSession;
  scope: ProgrammeScope;
}) {
  const m = await dashboardMetrics(
    active.membership.organisationId,
    visibleEntityIds(active)
  );

  return (
    <div className="space-y-10">
      <Tiles>
        <Tile
          label="Awaiting a decision"
          value={m.attention.awaitingDecision}
          note={`${m.attention.openGates} approval gate${m.attention.openGates === 1 ? '' : 's'} open`}
          href="/app/tasks"
          tone={m.attention.awaitingDecision > 0 ? 'warn' : 'plain'}
        />
        <Tile
          label="Overdue"
          value={m.attention.overdueTasks}
          note="past their service level"
          href="/app/tasks"
          tone={m.attention.overdueTasks > 0 ? 'stop' : 'plain'}
        />
        <Tile
          label="Not within appetite"
          value={m.attention.notWithinAppetite}
          note={
            m.unratedRisks > 0
              ? `includes ${m.unratedRisks} unrated`
              : 'residual high or critical'
          }
          href="/app/risks"
          tone={m.attention.notWithinAppetite > 0 ? 'stop' : 'plain'}
        />
        <Tile
          label="Lapsed acceptances"
          value={m.attention.lapsedAcceptances}
          note="need looking at again"
          href="/app/risks"
          tone={m.attention.lapsedAcceptances > 0 ? 'warn' : 'plain'}
        />
      </Tiles>

      <TaskPanel
        active={active}
        persona="privacy_governance"
        title="Waiting on you"
        empty="Nothing is waiting on you."
      />

      <QuickLinks
        active={active}
        scope={scope}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */

/** AI governance: what is running, and what nobody has looked at. */
export async function AiHome({
  active,
  scope
}: {
  active: ActiveSession;
  scope: ProgrammeScope;
}) {
  const organisationId = active.membership.organisationId;
  const entityIds = visibleEntityIds(active);
  const [summary, estate, incidents, profile] = await Promise.all([
    registerSummary(organisationId, entityIds),
    aiEstate(active),
    can(active.membership.grants, 'record.read')
      ? listIncidents(organisationId, entityIds, { openOnly: true })
      : Promise.resolve([]),
    // The profile is the NIST AI RMF's. An organisation following DSIT's
    // categories files its risks by category instead, and is not shown four
    // functions it does not organise its work around.
    scope.aiFramework === 'nist_ai_rmf' &&
    can(active.membership.grants, 'record.read')
      ? nistProfileTally(organisationId)
      : Promise.resolve(null)
  ]);
  const harmed = incidents.filter((i) => i.incident.harm === 'actual').length;

  return (
    <div className="space-y-10">
      <Tiles>
        <Tile
          label="On the register"
          value={summary.total}
          note={`${summary.live} live, ${summary.neverAssessed} never assessed`}
          href="/app/ai"
          tone={summary.neverAssessed > 0 ? 'stop' : 'plain'}
        />
        <Tile
          label="Running unexamined"
          value={summary.serious}
          note="unassessed, unmonitored or unsupervised"
          href="/app/ai"
          tone={summary.serious > 0 ? 'stop' : 'plain'}
        />
        <Tile
          label="Awaiting a decision"
          value={estate.awaitingDecision}
          note="assessments with a reviewer"
          href="/app/tasks"
          tone={estate.awaitingDecision > 0 ? 'warn' : 'plain'}
        />
        <Tile
          label="Open incidents"
          value={incidents.length}
          note={
            harmed > 0
              ? `${harmed} with harm reported`
              : 'harm, challenges and concerns'
          }
          href="/app/ai/incidents"
          tone={harmed > 0 ? 'stop' : incidents.length > 0 ? 'warn' : 'plain'}
        />
      </Tiles>

      {profile ? <ProfileStrip functions={profile} /> : null}

      <Panel
        title="Needs attention"
        hint="Systems with something outstanding, worst first."
        action={{ href: '/app/ai', label: 'Whole register' }}
      >
        {summary.withGaps === 0 ? (
          <Empty>
            {summary.total === 0
              ? 'Nothing on the register yet. Start with what you already know is running.'
              : 'Nothing outstanding across the register.'}
          </Empty>
        ) : (
          <Rows>
            {summary.entries
              .filter((e) => e.gaps.length > 0)
              .sort((a, b) => {
                const weight = (g: typeof a.gaps) =>
                  g.filter((x) => SERIOUS_GAPS.includes(x)).length * 10 +
                  g.length;
                return weight(b.gaps) - weight(a.gaps);
              })
              .slice(0, 8)
              .map((e) => (
                <Row
                  key={e.useCase.id}
                  href={`/app/ai/${e.useCase.id}`}
                  title={e.useCase.name}
                  detail={e.gaps.map((g) => GAP_WORDS[g]).join(' · ')}
                  meta={STAGE_LABEL[e.useCase.lifecycleStage as LifecycleStage]}
                  tone={
                    e.gaps.some((g) => SERIOUS_GAPS.includes(g))
                      ? 'stop'
                      : 'warn'
                  }
                />
              ))}
          </Rows>
        )}
      </Panel>

      <TaskPanel
        active={active}
        persona="ai_governance"
        title="Waiting on you"
        empty="Nothing is waiting on you."
      />

      <QuickLinks
        active={active}
        scope={scope}
      />
    </div>
  );
}

/**
 * Where the organisation stands on each NIST AI RMF function: outcomes met,
 * and how many fall short of the target it set. Counted from the profile, so
 * nothing here is a score the platform made up.
 */
function ProfileStrip({
  functions
}: {
  functions: Awaited<ReturnType<typeof nistProfileTally>>;
}) {
  return (
    <Panel
      title="NIST AI RMF profile"
      hint="Outcomes met in each function, and those short of your target."
      action={{ href: '/app/ai/profile', label: 'Whole profile' }}
    >
      <Tiles>
        {functions.map((f) => {
          const t = f.tally;
          const applicable =
            t.not_started + t.partial + t.achieved + t.unassessed;
          return (
            <Tile
              key={f.fn}
              label={f.label}
              value={`${t.achieved} of ${applicable}`}
              note={
                t.targetsSet === 0
                  ? 'no targets set yet'
                  : t.gaps > 0
                    ? `${t.gaps} short of target`
                    : 'at target'
              }
              href={`/app/ai/profile#${f.fn.toLowerCase()}`}
              tone={t.gaps > 0 ? 'warn' : t.targetsSet > 0 ? 'good' : 'plain'}
            />
          );
        })}
      </Tiles>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */

/** Engineering: what is being asked about your services, and what you owe. */
export async function EngineeringHome({ active }: { active: ActiveSession }) {
  const controls = await myMitigations(active);

  return (
    <div className="space-y-10">
      <TaskPanel
        active={active}
        persona="engineering"
        title="Questions for you"
        hint="Someone needs an answer about a system you run."
        empty="Nothing is waiting on you right now."
      />

      <Panel
        title="Controls you own"
        hint="Things you agreed to put in place, and when they are due."
      >
        {controls.length === 0 ? (
          <Empty>You are not on the hook for any controls.</Empty>
        ) : (
          <Rows>
            {controls.map(({ mitigation, risk }) => {
              const due = dueWords(mitigation.dueAt);
              return (
                <Row
                  key={mitigation.id}
                  href={`/app/risks/${risk.id}`}
                  title={mitigation.description}
                  detail={`On ${risk.reference} - ${risk.title}`}
                  meta={`${mitigation.status.replace(/_/g, ' ')} · ${due.text}`}
                  tone={due.tone}
                />
              );
            })}
          </Rows>
        )}
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------------ */

/** Product: can this ship, and what is holding it up. */
export async function ProductHome({ active }: { active: ActiveSession }) {
  const mine = await myAssessments(active);
  const cleared = mine.filter((r) => r.assessment.status === 'approved').length;
  const needsYou = mine.filter((r) =>
    ['draft', 'in_progress', 'returned'].includes(r.assessment.status)
  ).length;

  return (
    <div className="space-y-10">
      <section className="rounded border border-line bg-surface p-5">
        <h2 className="text-base font-semibold">Starting something new?</h2>
        <p className="mt-1 max-w-prose text-sm text-ink-soft">
          A few short questions will tell you whether it needs a closer look
          before it goes live. Most things do not.
        </p>
        <Link
          href="/app/assessments"
          className="mt-3 inline-block rounded bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          Check whether it needs a review
        </Link>
      </section>

      {needsYou > 0 ? (
        <div className="rounded border-l-2 border-amber-700 bg-amber-50 px-4 py-3">
          <p className="text-sm text-amber-950">
            <strong>
              {needsYou} of your requests {needsYou === 1 ? 'needs' : 'need'}{' '}
              something from you.
            </strong>{' '}
            {needsYou === 1
              ? 'Nothing moves until it is finished.'
              : 'Nothing moves until they are finished.'}
          </p>
        </div>
      ) : null}

      <Panel
        title="Your requests"
        hint="What you have asked for, and where it stands."
      >
        {mine.length === 0 ? (
          <Empty>
            You have not asked for anything yet. Start with the check above.
          </Empty>
        ) : (
          <Rows>
            {mine.slice(0, 10).map(({ assessment: a }) => (
              <Row
                key={a.id}
                href={`/app/assessments/${a.id}`}
                title={a.title}
                detail={
                  a.status === 'returned'
                    ? 'Sent back - see what was asked for'
                    : a.status === 'in_review'
                      ? 'Nothing needed from you while this is being looked at'
                      : null
                }
                meta={statusWords(a.status, 'product')}
                tone={
                  a.status === 'returned'
                    ? 'warn'
                    : a.status === 'rejected'
                      ? 'stop'
                      : 'plain'
                }
              />
            ))}
          </Rows>
        )}
        {cleared > 0 ? (
          <p className="text-xs text-ink-soft">
            {cleared} cleared and on record.
          </p>
        ) : null}
      </Panel>

      <TaskPanel
        active={active}
        persona="product"
        title="Anything else waiting on you"
        empty="Nothing else."
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */

async function QuickLinks({
  active,
  scope
}: {
  active: ActiveSession;
  scope: ProgrammeScope;
}) {
  const items = navFor(active.membership.grants, scope).filter(
    (i) => i.href !== '/app/tasks'
  );
  // Administration is a different kind of thing from a register. Mixed into
  // one list it reads as an afterthought, which is how somebody who knew a
  // screen existed still could not find it.
  const work = items.filter((i) => i.group !== 'admin');
  const admin = items.filter((i) => i.group === 'admin');

  if (items.length === 0) return null;
  return (
    <>
      {work.length > 0 ? (
        <Panel title="Everything else">
          <Rows>
            {work.map((i) => (
              <Row
                key={i.href}
                href={i.href}
                title={i.label}
                detail={i.hint}
              />
            ))}
          </Rows>
        </Panel>
      ) : null}
      {admin.length > 0 ? (
        <Panel title="Setting this up">
          <Rows>
            {admin.map((i) => (
              <Row
                key={i.href}
                href={i.href}
                title={i.label}
                detail={i.hint}
              />
            ))}
          </Rows>
        </Panel>
      ) : null}
    </>
  );
}

export { QuickLinks };
