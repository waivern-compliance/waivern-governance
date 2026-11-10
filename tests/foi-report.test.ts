import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';

import { db, sql as pg } from '@/db/client';
import {
  auditEvents,
  entities,
  informationRequests,
  memberships,
  organisations,
  users
} from '@/db/schema';
import {
  foiFigures,
  percent,
  reportPeriod,
  reportPeriods,
  type ReportRequest
} from '@/lib/foi/report';
import { setFreedomOfInformation } from '@/services/entities';
import { exportInformationRequests } from '@/services/exports';
import { foiAttention, foiReport } from '@/services/foi-reporting';
import { requestInformationRequestReview } from '@/services/information-request-reviews';
import {
  InformationRequestRefused,
  recordInformationRequest,
  recordInformationRequestDecision,
  respondToInformationRequest,
  setInformationRequestOutcome
} from '@/services/information-requests';

const SYSTEM = {
  actorKind: 'system' as const,
  actorUserId: null,
  actorLabel: 'foi report test'
};
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const refusedWith = (pattern: RegExp) => (error: unknown) =>
  error instanceof InformationRequestRefused && pattern.test(error.message);

after(() => pg.end());

describe('periods', () => {
  const now = new Date('2026-11-10T12:00:00Z');

  it('reads a year or a quarter, and falls back to this year', () => {
    const q = reportPeriod('2026-Q2', now);
    assert.equal(q.label, 'April to June 2026');
    // Midnight in the UK, which is 23:00 UTC the day before in summer.
    assert.equal(q.from.toISOString(), '2026-03-31T23:00:00.000Z');
    assert.equal(q.to.toISOString(), '2026-06-30T23:00:00.000Z');
    assert.equal(
      reportPeriod('2025', now).to.toISOString(),
      '2026-01-01T00:00:00.000Z'
    );
    for (const bad of [
      undefined,
      '',
      'Q3',
      '2026-Q5',
      '2027',
      '2027-Q1',
      '0050',
      '1999'
    ])
      assert.equal(reportPeriod(bad, now).key, '2026', String(bad));
  });

  it('offers each year since the first request, and the quarters begun', () => {
    const keys = reportPeriods(new Date('2025-08-01T00:00:00Z'), now).map(
      (p) => p.key
    );
    assert.deepEqual(keys, [
      '2026',
      '2026-Q4',
      '2026-Q3',
      '2026-Q2',
      '2026-Q1',
      '2025',
      '2025-Q4',
      '2025-Q3',
      '2025-Q2',
      '2025-Q1'
    ]);
    assert.deepEqual(reportPeriods(null, now).map((p) => p.key)[0], '2026');
  });
});

describe('rates', () => {
  it('round down, so one late response never reads as 100%', () => {
    assert.equal(percent(249 / 250), '99%');
    assert.equal(percent(1), '100%');
    assert.equal(percent(0.29), '29%');
    assert.equal(percent(null), '-');
  });
});

describe('a request under both regimes', () => {
  it('is judged under each by its own deadline', () => {
    const period = reportPeriod('2026-Q1', new Date('2026-11-10T00:00:00Z'));
    const figures = foiFigures({
      period,
      requests: [
        {
          id: 'both',
          regimes: ['foia', 'eir'],
          receivedAt: new Date('2026-02-01T00:00:00Z'),
          status: 'responded',
          // Late by the EIR's twenty days, in time by FOIA's public interest date.
          clockState: 'late',
          regimeStates: { foia: 'met', eir: 'late' },
          outcome: 'released_in_part'
        }
      ],
      refusals: [],
      reviews: [],
      regulatorEvents: []
    });
    const [foia, eir] = figures.byRegime;
    assert.equal(foia.inTime, 1);
    assert.equal(foia.late, 0);
    assert.equal(eir.late, 1);
    assert.equal(figures.total.late, 1);
  });
});

describe('the figures', () => {
  const period = reportPeriod('2026-Q1', new Date('2026-11-10T00:00:00Z'));
  const at = new Date('2026-02-01T00:00:00Z');
  const req = (
    id: string,
    over: Partial<ReportRequest> = {}
  ): ReportRequest => ({
    id,
    regimes: ['foia'],
    receivedAt: at,
    status: 'responded',
    clockState: 'met',
    outcome: 'released_in_full',
    ...over
  });

  const figures = foiFigures({
    period,
    requests: [
      req('a', { regimes: ['foia', 'eir'] }),
      req('b', { clockState: 'late', outcome: 'withheld_in_full' }),
      req('c', { status: 'open', clockState: 'overdue', outcome: null }),
      req('d', { status: 'open', clockState: 'running', outcome: null }),
      req('e', { status: 'closed', clockState: 'closed', outcome: null }),
      req('f', { outcome: null }),
      // Outside the period: counted nowhere.
      req('x', { receivedAt: new Date('2026-04-01T00:00:00Z') })
    ],
    refusals: [
      {
        requestId: 'b',
        kind: 'exemption',
        regime: 'foia',
        provision: 's.43',
        title: 'Commercial interests'
      },
      {
        requestId: 'b',
        kind: 'exemption',
        regime: 'foia',
        provision: 's.43',
        title: 'Commercial interests'
      },
      {
        requestId: 'a',
        kind: 'exemption',
        regime: 'eir',
        provision: 'reg 12(5)(e)',
        title: 'Commercial confidentiality'
      },
      {
        requestId: 'c',
        kind: 'cost_limit',
        regime: 'foia',
        provision: 's.12',
        title: null
      },
      {
        requestId: 'x',
        kind: 'exemption',
        regime: 'foia',
        provision: 's.43',
        title: 'Commercial interests'
      }
    ],
    reviews: [
      {
        requestId: 'b',
        status: 'decided',
        outcome: 'upheld',
        clockState: 'met'
      },
      {
        requestId: 'x',
        status: 'decided',
        outcome: 'reversed',
        clockState: 'late'
      }
    ],
    regulatorEvents: [
      { requestId: 'b', kind: 'application' },
      { requestId: 'x', kind: 'application' }
    ]
  });

  it('counts timeliness only where the time has run', () => {
    assert.equal(figures.total.received, 6);
    assert.equal(figures.total.inTime, 2);
    assert.equal(figures.total.late, 1);
    assert.equal(figures.total.overdue, 1);
    assert.equal(figures.total.inProgress, 1);
    assert.equal(figures.total.noResponseOwed, 1);
    // In time, out of in time, late and overdue: the running and closed ones wait.
    assert.equal(figures.total.inTimeRate, 2 / 4);
  });

  it('counts a request under both regimes under each', () => {
    const [foia, eir] = figures.byRegime;
    assert.equal(foia.regime, 'foia');
    assert.equal(foia.received, 6);
    assert.equal(eir.regime, 'eir');
    assert.equal(eir.received, 1);
    assert.equal(figures.byRegime.length, 2);
  });

  it('counts outcomes, and owns up to those not recorded', () => {
    const count = (label: string) =>
      figures.outcomes.find((o) => o.label === label)?.count;
    assert.equal(count('Released in full'), 1);
    assert.equal(count('Withheld in full'), 1);
    assert.equal(count('Not held'), 0);
    assert.equal(count('Not recorded'), 1);
  });

  it('counts each ground once per request, and only for the period', () => {
    assert.deepEqual(
      figures.refusals.map((r) => [r.regime, r.provision, r.label, r.requests]),
      [
        ['foia', 's.12', 'Cost limit', 1],
        ['foia', 's.43', 'Commercial interests', 1],
        ['eir', 'reg 12(5)(e)', 'Commercial confidentiality', 1]
      ]
    );
  });

  it('follows reviews and regulator cases with their request', () => {
    assert.equal(figures.reviews.requested, 1);
    assert.equal(figures.reviews.upheld, 1);
    assert.equal(figures.reviews.reversed, 0);
    assert.equal(figures.regulator.applications, 1);
  });
});

async function world(label: string) {
  const [org] = await db
    .insert(organisations)
    .values({
      name: `FOI report ${label}`,
      slug: `foi-report-${label}-${crypto.randomUUID().slice(0, 8)}`
    })
    .returning();
  const [entity] = await db
    .insert(entities)
    .values({ organisationId: org.id, name: 'Council', isDefault: true })
    .returning();
  const [handler] = await db
    .insert(users)
    .values({ email: `handler-${crypto.randomUUID().slice(0, 8)}@example.com` })
    .returning();
  await db
    .insert(memberships)
    .values({ organisationId: org.id, userId: handler.id });
  await setFreedomOfInformation({
    organisationId: org.id,
    entityId: entity.id,
    act: 'foia',
    timeProfile: 'standard',
    actor: SYSTEM
  });
  return { org, entity };
}

describe('the figures from the record', () => {
  it('records what a response came to, and keeps it consistent with the decisions', async () => {
    const w = await world('outcome');
    const received = daysAgo(60);
    const ask = (kind?: 'both') =>
      recordInformationRequest({
        organisationId: w.org.id,
        entityId: w.entity.id,
        channel: 'email',
        receivedAt: received,
        description: 'Spending on agency staff in 2025.',
        requesterName: 'Alex Applicant',
        correspondenceAddress: 'alex@example.com',
        ...(kind ? { kind } : {}),
        actor: SYSTEM
      });
    const respond = (
      requestId: string,
      outcome: Parameters<typeof respondToInformationRequest>[0]['outcome'],
      refusalNoticeChecked = false
    ) =>
      respondToInformationRequest({
        organisationId: w.org.id,
        requestId,
        respondedAt: daysAgo(50),
        summary: 'Sent.',
        outcome,
        refusalNoticeChecked,
        actor: SYSTEM
      });

    const released = await ask('both');
    await assert.rejects(
      respond(released.id, 'withheld_in_full'),
      refusedWith(/Nothing is recorded as refused/)
    );
    await respond(released.id, 'released_in_full');

    const withheld = await ask();
    for (let i = 0; i < 2; i++)
      await recordInformationRequestDecision({
        organisationId: w.org.id,
        requestId: withheld.id,
        kind: 'exemption',
        provision: 's.21',
        rationale: 'Already published on our website.',
        actor: SYSTEM
      });
    await assert.rejects(
      respond(withheld.id, 'released_in_full', true),
      refusedWith(/not released in full/)
    );
    await respond(withheld.id, 'withheld_in_full', true);
    await requestInformationRequestReview({
      organisationId: w.org.id,
      requestId: withheld.id,
      requestedAt: daysAgo(1),
      channel: 'email',
      grounds: 'It is not all published.',
      actor: SYSTEM
    });

    await ask(); // Never answered: overdue.

    const { figures, period } = await foiReport(
      w.org.id,
      null,
      String(received.getUTCFullYear())
    );
    assert.equal(period.key, String(received.getUTCFullYear()));
    assert.equal(figures.total.received, 3);
    assert.equal(figures.total.inTime, 2);
    assert.equal(figures.total.overdue, 1);
    assert.equal(figures.total.inTimeRate, 2 / 3);
    assert.deepEqual(
      figures.byRegime.map((r) => [r.regime, r.received]),
      [
        ['foia', 3],
        ['eir', 1]
      ]
    );
    assert.deepEqual(
      figures.refusals.map((r) => [r.provision, r.requests]),
      [['s.21', 1]]
    );
    assert.equal(
      figures.outcomes.find((o) => o.outcome === 'withheld_in_full')?.count,
      1
    );
    assert.equal(figures.reviews.requested, 1);
    assert.equal(figures.reviews.open, 1);

    // Another entity's view sees none of it.
    const none = await foiReport(
      w.org.id,
      [],
      String(received.getUTCFullYear())
    );
    assert.equal(none.figures.total.received, 0);

    const attention = await foiAttention(w.org.id, null);
    assert.equal(attention.overdue, 1);
    assert.deepEqual(await foiAttention(w.org.id, []), {
      dueSoon: 0,
      overdue: 0,
      reviewsDueSoon: 0,
      reviewsOverdue: 0
    });

    // The export keeps the record and leaves the requester behind.
    const exported = await exportInformationRequests(w.org.id, null);
    assert.equal(exported.rows.length, 3);
    const flat = JSON.stringify(exported.rows);
    for (const personal of [
      'Alex Applicant',
      'alex@example.com',
      'agency staff',
      'It is not all published'
    ])
      assert.doesNotMatch(flat, new RegExp(personal), personal);
    assert.match(flat, /Withheld in full/);
    assert.match(flat, /exemption \(FOIA\) s\.21/);
  });
});

describe('keeping the outcome honest', () => {
  async function setUp(label: string) {
    const w = await world(label);
    const request = await recordInformationRequest({
      organisationId: w.org.id,
      entityId: w.entity.id,
      channel: 'email',
      receivedAt: daysAgo(10),
      description: 'Contract rates.',
      requesterName: 'Alex Applicant',
      correspondenceAddress: 'alex@example.com',
      actor: SYSTEM
    });
    const decide = (
      over: Partial<Parameters<typeof recordInformationRequestDecision>[0]>
    ) =>
      recordInformationRequestDecision({
        organisationId: w.org.id,
        requestId: request.id,
        kind: 'exemption',
        rationale: 'Weighed.',
        actor: SYSTEM,
        ...over
      });
    const respond = (
      outcome: Parameters<typeof respondToInformationRequest>[0]['outcome']
    ) =>
      respondToInformationRequest({
        organisationId: w.org.id,
        requestId: request.id,
        respondedAt: new Date(),
        summary: 'Sent.',
        outcome,
        refusalNoticeChecked: true,
        actor: SYSTEM
      });
    return { w, request, decide, respond };
  }

  it('lets a qualified exemption be weighed and not applied, and then released in full', async () => {
    const { decide, respond } = await setUp('outweighed');
    await assert.rejects(
      decide({ provision: 's.21', detail: { applied: false } }),
      refusedWith(/no public interest test/)
    );
    const weighed = await decide({
      provision: 's.43',
      detail: {
        applied: false,
        factorsFor: 'Spending of public money.',
        factorsAgainst: 'Some commercial harm.'
      }
    });
    assert.equal(weighed.detail.applied, false);
    await assert.rejects(
      respond('withheld_in_full'),
      refusedWith(/Nothing is recorded as refused/)
    );
    const responded = await respond('released_in_full');
    assert.equal(responded.outcome, 'released_in_full');
    // Not a refusal: no notice was needed.
    assert.equal(responded.refusalNoticeChecked, null);
  });

  it('keeps a refusal of the whole request to the grounds that refuse it whole', async () => {
    const { decide, respond } = await setUp('whole');
    await decide({ provision: 's.21' });
    await assert.rejects(
      respond('refused_request'),
      refusedWith(/refused as a whole needs/)
    );
    await decide({
      kind: 'cost_limit',
      provision: null,
      detail: { estimatedHours: 30 }
    });
    const responded = await respond('refused_request');
    assert.equal(responded.outcome, 'refused_request');
  });

  it('follows what the record says is held', async () => {
    const { decide, respond } = await setUp('held');
    await decide({ kind: 'held', detail: { held: 'not_held' } });
    await assert.rejects(
      respond('released_in_full'),
      refusedWith(/not held, so nothing was released/)
    );
    await decide({ kind: 'held', detail: { held: 'held' } });
    await assert.rejects(
      respond('not_held'),
      refusedWith(/says the information is held/)
    );
    await respond('released_in_full');
  });

  it('can be corrected, or given to a response from before it was asked for, and is audited', async () => {
    const { w, request, respond } = await setUp('correct');
    await assert.rejects(
      setInformationRequestOutcome({
        organisationId: w.org.id,
        requestId: request.id,
        outcome: 'not_held',
        actor: SYSTEM
      }),
      refusedWith(/has been responded to/)
    );
    await respond('released_in_full');
    await db
      .update(informationRequests)
      .set({ outcome: null })
      .where(eq(informationRequests.id, request.id));
    await assert.rejects(
      setInformationRequestOutcome({
        organisationId: w.org.id,
        requestId: request.id,
        outcome: 'withheld_in_full',
        actor: SYSTEM
      }),
      refusedWith(/Nothing is recorded as refused/)
    );
    const corrected = await setInformationRequestOutcome({
      organisationId: w.org.id,
      requestId: request.id,
      outcome: 'not_held',
      actor: SYSTEM
    });
    assert.equal(corrected.outcome, 'not_held');
    const [event] = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organisationId, w.org.id),
          eq(auditEvents.action, 'foi.outcome_set')
        )
      );
    assert.deepEqual(event.before, { outcome: null });
    assert.deepEqual(event.after, { outcome: 'not_held' });
  });
});

describe('the dashboard and the export, by entity', () => {
  it('counts overdue reviews, and only for the entities given', async () => {
    const w = await world('by-entity');
    const request = await recordInformationRequest({
      organisationId: w.org.id,
      entityId: w.entity.id,
      channel: 'email',
      receivedAt: daysAgo(80),
      description: 'Agency spend.',
      requesterName: 'Alex Applicant',
      correspondenceAddress: 'alex@example.com',
      actor: SYSTEM
    });
    await respondToInformationRequest({
      organisationId: w.org.id,
      requestId: request.id,
      respondedAt: daysAgo(70),
      summary: 'Sent.',
      outcome: 'released_in_full',
      actor: SYSTEM
    });
    await requestInformationRequestReview({
      organisationId: w.org.id,
      requestId: request.id,
      requestedAt: daysAgo(60),
      channel: 'email',
      grounds: 'Not everything was sent.',
      actor: SYSTEM
    });
    const all = await foiAttention(w.org.id, null);
    assert.equal(all.reviewsOverdue, 1);
    const [other] = await db
      .insert(entities)
      .values({ organisationId: w.org.id, name: 'Trading arm' })
      .returning();
    assert.equal((await foiAttention(w.org.id, [other.id])).reviewsOverdue, 0);
    assert.equal(
      (await foiAttention(w.org.id, [w.entity.id])).reviewsOverdue,
      1
    );

    assert.equal(
      (await exportInformationRequests(w.org.id, [other.id])).rows.length,
      0
    );
    assert.equal(
      (await exportInformationRequests(w.org.id, [w.entity.id])).rows.length,
      1
    );
  });
});
