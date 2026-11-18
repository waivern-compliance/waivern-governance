import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';

import { db, sql as pg } from '@/db/client';
import {
  entities,
  informationRequestDecisions,
  informationRequestReviews,
  informationRequests,
  notifications,
  organisations,
  tasks,
  webhookDeliveries
} from '@/db/schema';
import type { ImportMapping } from '@/lib/import/types';
import { foiReport } from '@/services/foi-reporting';
import {
  commitImport,
  confirmImportedRecord,
  ImportRefused,
  loadImport,
  previewImport,
  undoImport,
  uploadImport
} from '@/services/imports';
import {
  loadInformationRequest,
  recordClarification,
  recordInformationRequest,
  recordInformationRequestDecision
} from '@/services/information-requests';
import { sweepOrganisation } from '@/services/sweep';

const SYSTEM = {
  actorKind: 'system' as const,
  actorUserId: null,
  actorLabel: 'FOI import test'
};

after(() => pg.end());

const refused = (pattern: RegExp) => (e: unknown) =>
  e instanceof ImportRefused && pattern.test(e.message);

const daysAgo = (n: number) =>
  new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const daysAhead = (n: number) => daysAgo(-n);

async function world(label: string, foiAct: 'foia' | 'foisa' | null = 'foia') {
  const [org] = await db
    .insert(organisations)
    .values({
      name: label,
      slug: `${label}-${crypto.randomUUID().slice(0, 8)}`
    })
    .returning();
  const [entity] = await db
    .insert(entities)
    .values({
      organisationId: org.id,
      name: 'Council',
      isDefault: true,
      dataProtectionLaw: 'uk',
      foiAct
    })
    .returning();
  return { org, entity };
}

/** Upload, preview with the columns as guessed, and import. */
async function imported(
  organisationId: string,
  text: string,
  extra: Partial<ImportMapping> = {}
) {
  const batch = await uploadImport({
    organisationId,
    recordType: 'information_request',
    sourceName: 'OneTrust',
    filename: 'foi.csv',
    contentType: 'text/csv',
    bytes: new TextEncoder().encode(text),
    actor: SYSTEM
  });
  const { mapping } = (await loadImport(batch.id, organisationId))!;
  const preview = await previewImport({
    organisationId,
    batchId: batch.id,
    mapping: { ...mapping, ...extra },
    actor: SYSTEM
  });
  const previewed = (await loadImport(batch.id, organisationId))!;
  await commitImport({ organisationId, batchId: batch.id, actor: SYSTEM });
  return {
    batch,
    preview,
    notes: previewed.batch.previewNotes,
    rows: (await loadImport(batch.id, organisationId))!.rows
  };
}

const requestsOf = (organisationId: string) =>
  db
    .select()
    .from(informationRequests)
    .where(eq(informationRequests.organisationId, organisationId))
    .orderBy(informationRequests.externalRef);

const decisionsOf = (requestId: string) =>
  db
    .select()
    .from(informationRequestDecisions)
    .where(eq(informationRequestDecisions.requestId, requestId));

const reviewsOf = (requestId: string) =>
  db
    .select()
    .from(informationRequestReviews)
    .where(eq(informationRequestReviews.requestId, requestId));

const requestTasksOf = (organisationId: string) =>
  db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.organisationId, organisationId),
        eq(tasks.subjectType, 'information_request')
      )
    );

const HEADER =
  'ID,Requester,Received on,Status,Responded on,Outcome,Exemptions,Closed on';

describe('importing freedom of information requests', () => {
  it('keeps their real dates: an old answered one raises nothing, an open one past its twenty days is overdue and counted first', async () => {
    const w = await world('import-foi-clocks');
    const { preview, notes } = await imported(
      w.org.id,
      [
        HEADER,
        'F-1,Alex Example,2023-03-01,,2023-03-20,Released in part,s.43,',
        `F-2,Sam Example,${daysAgo(60)},,,,,`,
        `F-3,Jo Example,${daysAgo(5)},,,,,`,
        `F-4,Lee Example,${daysAgo(30)},Withdrawn,,,,${daysAgo(20)}`
      ].join('\n')
    );
    assert.deepEqual(preview, { create: 4 });
    assert.deepEqual(notes, { overdue: 1 });

    const [old, late, running, gone] = await requestsOf(w.org.id);
    assert.equal(old.status, 'responded');
    assert.equal(old.outcome, 'released_in_part');
    assert.equal(old.reference.startsWith('FOI-'), true);
    assert.deepEqual(old.regimes, ['foia']);
    assert.equal(late.status, 'open');
    assert.equal(running.status, 'open');
    assert.equal(gone.status, 'closed');
    assert.equal(old.importConfirmedAt, null);

    const [exemption] = await decisionsOf(old.id);
    assert.equal(exemption.kind, 'exemption');
    assert.equal(exemption.provision, 's.43');
    assert.equal(exemption.decidedByLabel, 'In OneTrust');
    assert.equal(exemption.detail.applied, true);

    for (const table of [webhookDeliveries, notifications])
      assert.equal(
        (
          await db
            .select()
            .from(table)
            .where(eq(table.organisationId, w.org.id))
        ).length,
        0
      );

    // The sweep reads their clocks as for any request: one task, for F-2.
    assert.equal((await sweepOrganisation(w.org.id)).foiDeadlinesRaised, 1);

    await confirmImportedRecord({
      organisationId: w.org.id,
      type: 'information_request',
      id: old.id,
      actor: SYSTEM
    });
    assert.ok((await requestsOf(w.org.id))[0].importConfirmedAt);

    // They count in the figures by their real dates, marked as imported.
    const report = await foiReport(w.org.id, null, '2023');
    assert.equal(report.figures.total.received, 1);
    assert.equal(report.figures.imported, 1);
    assert.equal(report.figures.refusals[0]?.provision, 's.43');
  });

  it('runs the same clock as a request recorded here with the same dates', async () => {
    const w = await world('import-foi-same');
    const received = daysAgo(40);
    const sought = daysAgo(38);
    const answered = daysAgo(20);
    await imported(
      w.org.id,
      [
        'ID,Requester,Received on,Clarification asked for on,Clarification received on',
        `F-1,Alex Example,${received},${sought},${answered}`
      ].join('\n')
    );
    const [mine] = await requestsOf(w.org.id);
    const typed = await recordInformationRequest({
      organisationId: w.org.id,
      entityId: w.entity.id,
      channel: 'email',
      receivedAt: new Date(received),
      description: 'Spending on consultants.',
      requesterName: 'Alex Example',
      actor: SYSTEM
    });
    for (const [step, at] of [
      ['sought', sought],
      ['received', answered]
    ] as const)
      await recordClarification({
        organisationId: w.org.id,
        requestId: typed.id,
        step,
        at: new Date(at),
        actor: SYSTEM
      });
    const a = (await loadInformationRequest(mine.id, w.org.id))!;
    const b = (await loadInformationRequest(typed.id, w.org.id))!;
    assert.equal(a.clock.state, b.clock.state);
    assert.equal(a.clock.words, b.clock.words);
  });

  it('refuses what the law or its grounds do not allow', async () => {
    const w = await world('import-foi-refusals');
    const { preview, rows } = await imported(
      w.org.id,
      [
        `${HEADER},How it arrived,Kind of information,Extended for complexity on,Review asked for on,Review decided on`,
        `F-1,A,${daysAgo(30)},,,,,,Phone,,,,`,
        `F-2,B,${daysAgo(30)},,${daysAgo(10)},Withheld in full,,,,,,,`,
        `F-3,C,${daysAgo(30)},,${daysAgo(10)},Released in part,s.99,,,,,,`,
        `F-4,D,${daysAgo(30)},,${daysAgo(10)},Withheld in full,s.40(1),,,,,,`,
        `F-5,E,${daysAgo(30)},,,,,,,,${daysAgo(25)},,`,
        `F-6,F,${daysAgo(30)},Open,${daysAgo(10)},,,,,,,,`,
        `F-7,G,${daysAgo(30)},,${daysAgo(10)},,,,,,,${daysAgo(8)},${daysAgo(2)}`,
        `F-8,H,${daysAgo(30)},,,Released in full,,,,,,,`
      ].join('\n')
    );
    assert.deepEqual(preview, { refuse: 8 });
    assert.match(rows[0].reason ?? '', /must be in writing/);
    assert.match(rows[1].reason ?? '', /Give the exemptions relied on/);
    assert.match(rows[2].reason ?? '', /"s.99" is not an exemption/);
    assert.match(rows[3].reason ?? '', /subject access request/);
    assert.match(rows[4].reason ?? '', /Only environmental information/);
    assert.match(rows[5].reason ?? '', /open there, but gives a date/);
    assert.match(rows[6].reason ?? '', /not what it decided/);
    assert.match(rows[7].reason ?? '', /no date it was sent/);

    const none = await world('import-foi-no-act', null);
    const { rows: noAct } = await imported(
      none.org.id,
      [HEADER, `F-1,A,${daysAgo(30)},,,,,`].join('\n')
    );
    assert.match(noAct[0].reason ?? '', /not recorded as answering/);
  });

  it('keeps an extension that moves the deadline, so a request within it is not overdue', async () => {
    const w = await world('import-foi-extended');
    const { notes } = await imported(
      w.org.id,
      [
        'ID,Requester,Received on,Kind of information,Extended for complexity on,Public interest notice sent on,Public interest decision due,Exemption being weighed',
        `F-1,Alex Example,${daysAgo(35)},Environmental,${daysAgo(30)},,,`,
        `F-2,Sam Example,${daysAgo(35)},,,${daysAgo(10)},${daysAhead(10)},s.43`
      ].join('\n')
    );
    assert.deepEqual(notes, { overdue: 0 });
    const [eir, foia] = await requestsOf(w.org.id);
    assert.equal(eir.extendedForComplexity, true);
    assert.deepEqual(eir.regimes, ['eir']);
    const [complexity] = await decisionsOf(eir.id);
    assert.equal(complexity.kind, 'complexity_extension');
    const [pi] = await decisionsOf(foia.id);
    assert.equal(pi.kind, 'public_interest_extension');
    assert.equal(pi.provision, 's.43');
  });

  it('brings in the latest review, overdue where it is still owed', async () => {
    const w = await world('import-foi-review');
    const { notes } = await imported(
      w.org.id,
      [
        'ID,Requester,Received on,Responded on,Outcome,Review asked for on,Review decided on,Review outcome',
        `F-1,Alex Example,${daysAgo(120)},${daysAgo(100)},Released in full,${daysAgo(90)},,`,
        `F-2,Sam Example,${daysAgo(120)},${daysAgo(100)},Released in full,${daysAgo(90)},${daysAgo(80)},Upheld`
      ].join('\n')
    );
    assert.deepEqual(notes, { overdue: 1 });
    const [open, decided] = await requestsOf(w.org.id);
    const [openReview] = await reviewsOf(open.id);
    assert.equal(openReview.status, 'open');
    assert.equal(openReview.aboutNoResponse, false);
    const [decidedReview] = await reviewsOf(decided.id);
    assert.equal(decidedReview.status, 'decided');
    assert.equal(decidedReview.outcome, 'upheld');
    assert.equal(
      (await sweepOrganisation(w.org.id)).foiReviewDeadlinesRaised,
      1
    );
  });

  it('reads the grounds for refusing under each regime, and refuses what a regime does not have', async () => {
    const w = await world('import-foi-grounds');
    const { preview, rows } = await imported(
      w.org.id,
      [
        'ID,Requester,Received on,Responded on,Outcome,Exemptions,Refused as,Kind of information,Public interest notice sent on,Public interest decision due,Exemption being weighed',
        `F-1,A,${daysAgo(40)},${daysAgo(30)},Request refused,,Cost limit,,,,`,
        `F-2,B,${daysAgo(40)},${daysAgo(30)},Released in part,s.43; reg 12(5)(e),,Both,,,`,
        `F-3,C,${daysAgo(40)},${daysAgo(30)},Request refused,,Vexatious,Environmental,,,`,
        `F-4,D,${daysAgo(40)},,,,,Environmental,${daysAgo(20)},${daysAhead(10)},s.43`,
        `F-5,E,${daysAgo(40)},${daysAgo(30)},Withheld in full,reg 12(4)(a),,Environmental,,,`
      ].join('\n')
    );
    assert.deepEqual(preview, { create: 3, refuse: 2 });
    assert.match(rows[2].reason ?? '', /no cost limit and no vexatious/);
    assert.match(rows[3].reason ?? '', /Only FOIA allows more time/);
    // F-3 and F-4 were refused, so these are F-1, F-2 and F-5.
    const [cost, both, notHeld] = await requestsOf(w.org.id);
    const [limit] = await decisionsOf(cost.id);
    assert.equal(limit.kind, 'cost_limit');
    assert.equal(limit.provision, 's.12');
    const grounds = await decisionsOf(both.id);
    assert.deepEqual(grounds.map((d) => [d.regime, d.provision]).sort(), [
      ['eir', 'reg 12(5)(e)'],
      ['foia', 's.43']
    ]);
    // Information not held has no public interest to weigh, so no factors.
    const [exception] = await decisionsOf(notHeld.id);
    assert.equal(exception.detail.factorsFor, undefined);
  });

  it('stops the time while a fee is awaited, and counts a paid fee as here', async () => {
    const w = await world('import-foi-fees');
    const { notes } = await imported(
      w.org.id,
      [
        'ID,Requester,Received on,Kind of information,Fees notice sent on,Fee asked for,Fee paid on,Responded on,Outcome',
        `F-1,A,${daysAgo(60)},Environmental,${daysAgo(55)},25,,,`,
        `F-2,B,${daysAgo(90)},Environmental,${daysAgo(85)},25,${daysAgo(50)},${daysAgo(40)},Released in full`
      ].join('\n')
    );
    assert.deepEqual(notes, { overdue: 0 });
    const [waiting, paid] = await requestsOf(w.org.id);
    assert.equal(
      (await loadInformationRequest(waiting.id, w.org.id))!.clock.state,
      'waiting'
    );
    const loaded = (await loadInformationRequest(paid.id, w.org.id))!;
    assert.equal(loaded.clock.state, 'met');
    assert.equal(paid.lateReason, null);
    assert.deepEqual((await decisionsOf(paid.id)).map((d) => d.kind).sort(), [
      'fee_paid',
      'fees_notice'
    ]);
  });

  it('marks a review asked for late, or decided late, as the source left it', async () => {
    const w = await world('import-foi-late-review');
    await imported(
      w.org.id,
      [
        'ID,Requester,Received on,Responded on,Outcome,Review asked for on,Review decided on,Review outcome',
        `F-1,A,${daysAgo(300)},${daysAgo(290)},Released in full,${daysAgo(150)},${daysAgo(80)},Upheld`
      ].join('\n')
    );
    const [request] = await requestsOf(w.org.id);
    const [review] = await reviewsOf(request.id);
    assert.match(
      review.lateAcceptedReason ?? '',
      /OneTrust recorded no reason/
    );
    assert.equal(review.lateReason, 'OneTrust recorded no reason.');
  });

  it('retires its deadline task when a later import says it was answered', async () => {
    const w = await world('import-foi-answered');
    const row = (responded: string) =>
      [
        'ID,Requester,Received on,Responded on,Outcome',
        `F-1,A,${daysAgo(60)},${responded},${responded ? 'Released in full' : ''}`
      ].join('\n');
    await imported(w.org.id, row(''));
    await sweepOrganisation(w.org.id);
    const [task] = await requestTasksOf(w.org.id);
    assert.equal(task.status, 'open');
    const again = await imported(w.org.id, row(daysAgo(2)));
    assert.deepEqual(again.preview, { update: 1 });
    const [done] = await requestTasksOf(w.org.id);
    assert.equal(done.status, 'done');
    assert.equal((await requestsOf(w.org.id))[0].status, 'responded');
  });

  it('leaves out requests that ended before the retention cut-off', async () => {
    const w = await world('import-foi-retention');
    const { preview, rows } = await imported(
      w.org.id,
      [
        HEADER,
        'F-1,Old,2019-01-02,,2019-01-20,Released in full,,',
        'F-2,Newer,2024-06-03,,2024-06-20,Released in full,,'
      ].join('\n'),
      { closedBefore: '2020-01-01' }
    );
    assert.deepEqual(preview, { skip: 1, create: 1 });
    assert.match(rows[0].reason ?? '', /before the retention cut-off/);
  });

  it('is undone with the decisions, review and tasks it brought, and not once a decision is recorded here', async () => {
    const w = await world('import-foi-undo');
    const file = [
      'ID,Requester,Received on,Responded on,Outcome,Exemptions,Review asked for on',
      `F-1,Alex Example,${daysAgo(120)},${daysAgo(100)},Released in part,s.43,${daysAgo(90)}`
    ].join('\n');
    const first = await imported(w.org.id, file);
    await sweepOrganisation(w.org.id);
    assert.equal((await requestTasksOf(w.org.id)).length, 1);
    await undoImport({
      organisationId: w.org.id,
      batchId: first.batch.id,
      actor: SYSTEM
    });
    assert.equal((await requestsOf(w.org.id)).length, 0);
    assert.equal((await requestTasksOf(w.org.id)).length, 0);

    const second = await imported(
      w.org.id,
      [HEADER, `F-1,Alex Example,${daysAgo(10)},,,,,`].join('\n')
    );
    const [request] = await requestsOf(w.org.id);
    await recordInformationRequestDecision({
      organisationId: w.org.id,
      requestId: request.id,
      kind: 'held',
      detail: { held: 'held' },
      rationale: 'Finance hold it.',
      actor: SYSTEM
    });
    await assert.rejects(
      undoImport({
        organisationId: w.org.id,
        batchId: second.batch.id,
        actor: SYSTEM
      }),
      refused(/can no longer be undone/)
    );
  });

  it('adds a review recorded since on a second import, refuses grounds told differently, and is not written over once worked on here', async () => {
    const w = await world('import-foi-again');
    const file = (exemption: string, review: string) =>
      [
        `${HEADER},Review asked for on,Requester's phone number`,
        `F-1,Alex Example,${daysAgo(60)},,${daysAgo(40)},Released in part,${exemption},,${review},07700 900000`
      ].join('\n');
    await imported(w.org.id, file('s.43', ''));
    const again = await imported(w.org.id, file('s.43', daysAgo(30)));
    assert.deepEqual(again.preview, { update: 1 });
    const [request] = await requestsOf(w.org.id);
    assert.deepEqual(request.legacy, {});
    assert.equal((await decisionsOf(request.id)).length, 1);
    const [review] = await reviewsOf(request.id);
    assert.equal(review.importBatchId, again.batch.id);

    const changed = await imported(w.org.id, file('s.42', daysAgo(30)));
    assert.deepEqual(changed.preview, { refuse: 1 });
    assert.match(changed.rows[0].reason ?? '', /something different/);

    // Its details changed here since it was imported and confirmed.
    await db
      .update(informationRequests)
      .set({ updatedAt: new Date(Date.now() + 1000) })
      .where(eq(informationRequests.id, request.id));
    const third = await imported(w.org.id, file('s.43', daysAgo(30)));
    assert.deepEqual(third.preview, { refuse: 1 });
    assert.match(third.rows[0].reason ?? '', /worked on here/);
  });
});
