import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';

import { db, sql as pg } from '@/db/client';
import {
  assessments,
  auditEvents,
  entities,
  organisations,
  schedules,
  suppliers,
  tasks,
  templates,
  templateVersions
} from '@/db/schema';
import { addMonths } from '@/lib/dates';
import { DUE_DILIGENCE_NAMES } from '@/lib/templates/library/supplier-due-diligence';
import {
  DEFAULT_REVIEW_MONTHS,
  nextReviewAt,
  outcomeOf,
  reviewMonthsFrom,
  reviewState
} from '@/lib/thirdparty/review';
import { installShippedWorkflows } from '@/services/approval-routing';
import {
  createAssessment,
  reviewSchedule,
  saveAnswers
} from '@/services/assessments';
import {
  setSupplierReviewCycle,
  supplierReviewCycle,
  supplierReviewSchedule,
  suppliersDueForReview
} from '@/services/supplier-review';
import { setSupplierTier } from '@/services/supplier-tier';
import { sweepOrganisation } from '@/services/sweep';
import { installShippedTemplates } from '@/services/templates';
import { createSupplier } from '@/services/third-party';
import {
  approvalsFor,
  decideApproval,
  submitForApproval
} from '@/services/workflow';

after(() => pg.end());

const SYSTEM = {
  actorKind: 'system' as const,
  actorUserId: null,
  actorLabel: 'review test'
};
const DAY = 86_400_000;

/** A light review a sound supplier would give, concluding as `recommendation`. */
const answers = (
  recommendation: string,
  conditions?: string
): Record<string, unknown> => ({
  supplier_name: 'Northwind Hosting',
  service: 'Hosting',
  security_contact: 'security@northwind.example',
  ai_involvement: 'none',
  personal_data: false,
  processing_locations: 'uk',
  sub_processors: 'none',
  certifications: ['none'],
  breach_notification: 'within_24h',
  recent_breaches: 'no',
  evidence_received: 'none_described',
  recommendation,
  ...(conditions ? { conditions } : {})
});

async function world(label: string) {
  const [org] = await db
    .insert(organisations)
    .values({
      name: `Review ${label}`,
      slug: `review-${label}-${crypto.randomUUID().slice(0, 8)}`
    })
    .returning();
  const [entity] = await db
    .insert(entities)
    .values({ organisationId: org.id, name: 'Main', isDefault: true })
    .returning();
  await installShippedWorkflows({ organisationId: org.id, actor: SYSTEM });
  await installShippedTemplates({
    organisationId: org.id,
    kinds: ['supplier_record'],
    actor: SYSTEM
  });
  const versionOf = async (name: string) => {
    const [v] = await db
      .select({ id: templateVersions.id })
      .from(templateVersions)
      .innerJoin(templates, eq(templates.id, templateVersions.templateId))
      .where(
        and(eq(templates.organisationId, org.id), eq(templates.name, name))
      );
    return v.id;
  };
  const supplier = await createSupplier({
    organisationId: org.id,
    name: `Northwind ${label}`,
    actor: SYSTEM
  });
  return {
    org,
    entity,
    supplier,
    light: await versionOf(DUE_DILIGENCE_NAMES.light),
    ai: await versionOf('AI supplier assessment')
  };
}

type World = Awaited<ReturnType<typeof world>>;

async function tier(w: World, t: string) {
  await setSupplierTier({
    organisationId: w.org.id,
    supplierId: w.supplier.id,
    tier: t,
    reason: 'Set for the test',
    actor: SYSTEM
  });
}

/** Run an assessment of the supplier through every approval stage. */
async function approve(
  w: World,
  versionId: string,
  given: Record<string, unknown>
) {
  const a = await createAssessment({
    organisationId: w.org.id,
    entityId: w.entity.id,
    templateVersionId: versionId,
    title: 'Supplier review',
    subjectType: 'supplier',
    subjectId: w.supplier.id,
    actor: SYSTEM
  });
  await saveAnswers({
    assessmentId: a.id,
    organisationId: w.org.id,
    answers: given as never,
    actor: SYSTEM
  });
  await submitForApproval({
    assessmentId: a.id,
    organisationId: w.org.id,
    actor: SYSTEM
  });
  for (const gate of await approvalsFor(a.id)) {
    if (gate.status !== 'pending') continue;
    await decideApproval({
      approvalId: gate.id,
      organisationId: w.org.id,
      decision: 'approved',
      rationale: 'Checked.',
      callerRoles: [gate.requiredRole],
      actor: SYSTEM
    });
  }
  return a;
}

async function supplierNow(w: World) {
  const [s] = await db
    .select()
    .from(suppliers)
    .where(eq(suppliers.id, w.supplier.id));
  return s;
}

async function assessmentNow(id: string) {
  const [a] = await db.select().from(assessments).where(eq(assessments.id, id));
  return a;
}

const sameDay = (a: Date | null, b: Date | null) =>
  a?.toISOString().slice(0, 10) === b?.toISOString().slice(0, 10);

describe('the review cycle', () => {
  it('maps a recommendation to an outcome', () => {
    assert.equal(outcomeOf('proceed'), 'approved');
    assert.equal(
      outcomeOf('proceed_with_conditions'),
      'approved_with_conditions'
    );
    assert.equal(outcomeOf('do_not_proceed'), 'exit');
    assert.equal(outcomeOf(undefined), null);
  });

  it('fills a stored cycle with the defaults where a tier is missing or out of range', () => {
    assert.deepEqual(reviewMonthsFrom({}), DEFAULT_REVIEW_MONTHS);
    assert.deepEqual(reviewMonthsFrom({ low: 48, medium: 0, high: 'x' }), {
      ...DEFAULT_REVIEW_MONTHS,
      low: 48
    });
  });

  it('dates the next review from the last by tier, or from when first tiered', () => {
    const last = new Date('2026-03-31T00:00:00Z');
    const first = new Date('2026-06-01T00:00:00Z');
    assert.equal(
      nextReviewAt(
        { tier: 'medium', lastReviewedAt: last },
        DEFAULT_REVIEW_MONTHS,
        first
      )
        ?.toISOString()
        .slice(0, 10),
      '2028-03-31'
    );
    assert.equal(
      nextReviewAt(
        { tier: 'low', lastReviewedAt: null },
        DEFAULT_REVIEW_MONTHS,
        first
      ),
      first
    );
    assert.equal(
      nextReviewAt(
        { tier: null, lastReviewedAt: last },
        DEFAULT_REVIEW_MONTHS,
        first
      ),
      null
    );
    const now = new Date('2026-06-01T00:00:00Z');
    assert.equal(reviewState(new Date('2026-05-01T00:00:00Z'), now), 'overdue');
    assert.equal(
      reviewState(new Date('2026-07-01T00:00:00Z'), now),
      'due_soon'
    );
    assert.equal(
      reviewState(new Date('2027-01-01T00:00:00Z'), now),
      'scheduled'
    );
    assert.equal(reviewState(null, now), 'none');
  });
});

describe('reviewing a supplier', () => {
  it('makes a newly tiered supplier due for its first review', async () => {
    const w = await world('first');
    assert.equal((await supplierNow(w)).nextReviewAt, null);
    await tier(w, 'low');
    const s = await supplierNow(w);
    assert.ok(s.nextReviewAt && s.nextReviewAt.getTime() <= Date.now());
    assert.deepEqual(
      (await suppliersDueForReview(w.org.id)).map((d) => d.id),
      [w.supplier.id]
    );
  });

  it('records the outcome of an approved due diligence assessment and dates the next by tier', async () => {
    const w = await world('approved');
    await tier(w, 'high');
    const a = await approve(
      w,
      w.light,
      answers('proceed_with_conditions', 'Encrypt backups by March')
    );
    const s = await supplierNow(w);
    assert.equal(s.reviewOutcome, 'approved_with_conditions');
    assert.equal(s.reviewConditions, 'Encrypt backups by March');
    assert.equal(s.reviewAssessmentId, a.id);
    assert.ok(s.lastReviewedAt);
    // High is yearly, not the light template's own 24 months.
    assert.ok(sameDay(s.nextReviewAt, addMonths(s.lastReviewedAt!, 12)));
    const reviewed = await assessmentNow(a.id);
    assert.ok(sameDay(reviewed.reviewDueAt, s.nextReviewAt));
    assert.equal(reviewed.reviewIntervalMonths, 12);
    // The supplier sweep brings it round, so it has no schedule of its own.
    assert.equal(
      (await db.select().from(schedules).where(eq(schedules.subjectId, a.id)))
        .length,
      0
    );
    const [event] = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organisationId, w.org.id),
          eq(auditEvents.action, 'supplier.reviewed')
        )
      );
    assert.equal(
      (event.after as { outcome: string }).outcome,
      'approved_with_conditions'
    );
  });

  it('supersedes the previous review with the next', async () => {
    const w = await world('again');
    await tier(w, 'medium');
    const first = await approve(w, w.light, answers('proceed'));
    const second = await approve(w, w.light, answers('proceed'));
    assert.equal((await assessmentNow(first.id)).status, 'superseded');
    assert.equal((await assessmentNow(second.id)).status, 'approved');
    assert.equal((await supplierNow(w)).reviewAssessmentId, second.id);
  });

  it('ends the cycle on an exit and asks for the contracts and agreements to be ended', async () => {
    const w = await world('exit');
    await tier(w, 'medium');
    const a = await approve(w, w.light, answers('do_not_proceed'));
    const s = await supplierNow(w);
    assert.equal(s.reviewOutcome, 'exit');
    assert.equal(s.nextReviewAt, null);
    assert.equal((await assessmentNow(a.id)).reviewDueAt, null);
    const [exit] = await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.organisationId, w.org.id),
          eq(tasks.idempotencyKey, `supplier-exit:${a.id}`)
        )
      );
    assert.ok(exit.title.startsWith(`Exit ${w.supplier.name}`));
    assert.match(
      exit.description ?? '',
      /0 contracts in force and 0 processor agreements/
    );
    assert.equal(exit.assigneeRole, 'privacy_admin');
    // Retiering an exited supplier does not start its cycle again.
    await tier(w, 'high');
    assert.equal((await supplierNow(w)).nextReviewAt, null);
  });

  it('does not treat an AI supplier assessment as a review', async () => {
    const w = await world('ai');
    await tier(w, 'medium');
    const before = (await supplierNow(w)).nextReviewAt;
    await approve(w, w.ai, {
      supplier_name: 'Northwind',
      ai_involvement: 'none',
      trains_on_our_data: 'no',
      personal_data: false,
      testing_evidence: 'independent',
      bias_testing: 'not_relevant',
      explainability: 'yes',
      atrs_support: 'not_needed',
      data_ethics: 'answered',
      security_assurance: ['iso27001'],
      ai_threats: 'yes',
      contract_terms: ['ai_use_disclosed'],
      lock_in: 'possible',
      fallback: 'yes',
      recommendation: 'proceed'
    });
    const s = await supplierNow(w);
    assert.equal(s.reviewOutcome, null);
    assert.ok(sameDay(s.nextReviewAt, before));
  });

  it('re-dates reviewed suppliers when the cycle or the tier changes', async () => {
    const w = await world('cycle');
    await tier(w, 'medium');
    const a = await approve(w, w.light, answers('proceed'));
    const last = (await supplierNow(w)).lastReviewedAt!;
    assert.ok(
      sameDay((await supplierNow(w)).nextReviewAt, addMonths(last, 24))
    );

    await setSupplierReviewCycle({
      organisationId: w.org.id,
      months: { critical: 6, high: 12, medium: 18, low: 36 },
      actor: SYSTEM
    });
    assert.equal((await supplierReviewCycle(w.org.id)).medium, 18);
    assert.ok(
      sameDay((await supplierNow(w)).nextReviewAt, addMonths(last, 18))
    );
    assert.ok(
      sameDay((await assessmentNow(a.id)).reviewDueAt, addMonths(last, 18))
    );

    await tier(w, 'critical');
    assert.ok(sameDay((await supplierNow(w)).nextReviewAt, addMonths(last, 6)));
    assert.equal((await assessmentNow(a.id)).reviewIntervalMonths, 6);
  });

  it('refuses a cycle that is not a whole number of months in range', async () => {
    const w = await world('bad-cycle');
    for (const months of [
      { critical: 0, high: 12, medium: 24, low: 36 },
      { critical: 12, high: 12, medium: 24, low: 121 },
      { critical: 12, high: 12, medium: 2.5, low: 36 },
      { critical: 12, high: 12, medium: 24 }
    ])
      await assert.rejects(
        setSupplierReviewCycle({
          organisationId: w.org.id,
          months: months as Record<string, number>,
          actor: SYSTEM
        }),
        /whole number of months/
      );
  });
});

describe('bringing reviews round', () => {
  it('raises one task naming how many suppliers are due, once a month', async () => {
    const w = await world('sweep');
    await tier(w, 'low');
    const other = await createSupplier({
      organisationId: w.org.id,
      name: `Other ${crypto.randomUUID().slice(0, 6)}`,
      actor: SYSTEM
    });
    await setSupplierTier({
      organisationId: w.org.id,
      supplierId: other.id,
      tier: 'low',
      reason: 'Set for the test',
      actor: SYSTEM
    });
    const first = await sweepOrganisation(w.org.id);
    assert.equal(first.supplierReviewsRaised, 2);
    const raised = await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.organisationId, w.org.id),
          eq(tasks.subjectType, 'supplier')
        )
      );
    assert.equal(raised.length, 1);
    assert.equal(raised[0].title, '2 suppliers are due for review');
    assert.equal(raised[0].assigneeRole, 'privacy_admin');
    assert.equal((await sweepOrganisation(w.org.id)).supplierReviewsRaised, 0);
  });

  it('brings a supplier review round as the supplier, not also as a lapsed assessment', async () => {
    const w = await world('lapsed');
    await tier(w, 'high');
    const a = await approve(w, w.light, answers('proceed'));
    const past = new Date(Date.now() - 10 * DAY);
    await db
      .update(suppliers)
      .set({ nextReviewAt: past })
      .where(eq(suppliers.id, w.supplier.id));
    await db
      .update(assessments)
      .set({ reviewDueAt: past })
      .where(eq(assessments.id, a.id));
    const result = await sweepOrganisation(w.org.id);
    assert.equal(result.supplierReviewsRaised, 1);
    assert.equal(result.lapsedReviewsRaised, 0);

    const page = await reviewSchedule(w.org.id, null);
    const listed = [
      ...page.overdue,
      ...page.dueSoon,
      ...page.scheduled,
      ...page.unscheduled
    ].map((i) => i.assessment.id);
    assert.ok(!listed.includes(a.id));
    const [row] = await supplierReviewSchedule(w.org.id);
    assert.equal(row.id, w.supplier.id);
    assert.equal(row.state, 'overdue');
  });
});
