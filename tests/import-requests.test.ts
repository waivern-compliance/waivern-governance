import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';

import { db, sql as pg } from '@/db/client';
import {
  dataSubjectRequestDecisions,
  dataSubjectRequests,
  entities,
  notifications,
  organisations,
  webhookDeliveries
} from '@/db/schema';
import type { ImportMapping } from '@/lib/import/types';
import {
  loadRequest,
  recordRequest,
  recordRequestDecision,
  requestMetrics
} from '@/services/data-subject-requests';
import {
  commitImport,
  confirmImportedRecord,
  ImportRefused,
  loadImport,
  previewImport,
  undoImport,
  uploadImport
} from '@/services/imports';
import { sweepOrganisation } from '@/services/sweep';

const SYSTEM = {
  actorKind: 'system' as const,
  actorUserId: null,
  actorLabel: 'request import test'
};

after(() => pg.end());

const refused = (pattern: RegExp) => (e: unknown) =>
  e instanceof ImportRefused && pattern.test(e.message);

const daysAgo = (n: number) =>
  new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

async function world(label: string, law: 'uk' | 'eu' | 'uk_eu' = 'uk') {
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
      name: 'Main',
      isDefault: true,
      dataProtectionLaw: law
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
    recordType: 'data_subject_request',
    sourceName: 'OneTrust',
    filename: 'requests.csv',
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
    .from(dataSubjectRequests)
    .where(eq(dataSubjectRequests.organisationId, organisationId))
    .orderBy(dataSubjectRequests.externalRef);

const HEADER =
  'ID,Requester,Email,Rights,Received on,Status,Responded on,Closed on,Extended,Extended on';

describe('importing data subject requests', () => {
  it('keeps their real dates: an old closed one raises nothing, an open one past its month is overdue and counted first', async () => {
    const w = await world('import-dsr-clocks');
    const { preview, notes } = await imported(
      w.org.id,
      [
        HEADER,
        'R-1,Alex Example,alex@example.com,SAR,2021-03-01,Completed,2021-03-20,,,',
        `R-2,Sam Example,,Erasure; Objection,${daysAgo(60)},In progress,,,,`,
        `R-3,Jo Example,,Access,${daysAgo(10)},,,,,`
      ].join('\n')
    );
    assert.deepEqual(preview, { create: 3 });
    assert.deepEqual(notes, { overdue: 1 });

    const [old, late, fresh] = await requestsOf(w.org.id);
    assert.equal(old.status, 'responded');
    assert.deepEqual(old.rights, ['access']);
    assert.equal(old.receivedAt.toISOString().slice(0, 10), '2021-03-01');
    assert.deepEqual(late.rights, ['erasure', 'objection']);
    assert.equal(fresh.status, 'in_progress');
    assert.equal(old.importConfirmedAt, null);

    // Nothing was sent or queued by the import itself.
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

    // The sweep reads their clocks as for any request: one task, for R-2.
    assert.equal((await sweepOrganisation(w.org.id)).requestDeadlinesRaised, 1);
  });

  it('runs the same clock as a request recorded here with the same dates', async () => {
    const w = await world('import-dsr-same');
    const received = daysAgo(20);
    await imported(
      w.org.id,
      [
        HEADER,
        `R-1,Alex Example,,Access,${received},,,,yes,${daysAgo(5)}`
      ].join('\n')
    );
    const [mine] = await requestsOf(w.org.id);
    const typed = await recordRequest({
      organisationId: w.org.id,
      entityId: w.entity.id,
      rights: ['access'],
      channel: 'email',
      receivedAt: new Date(received),
      description: 'A copy of my data.',
      requesterName: 'Alex Example',
      actor: SYSTEM
    });
    await recordRequestDecision({
      organisationId: w.org.id,
      requestId: typed.id,
      kind: 'extension',
      rationale: 'Complex.',
      effectiveAt: new Date(daysAgo(5)),
      actor: SYSTEM
    });
    const a = (await loadRequest(mine.id, w.org.id))!;
    const b = (await loadRequest(typed.id, w.org.id))!;
    assert.equal(a.clock.state, b.clock.state);
    assert.equal(a.extended, true);
    assert.equal(
      'dueAt' in a.clock && a.clock.dueAt.toISOString(),
      'dueAt' in b.clock && b.clock.dueAt.toISOString()
    );
    const [extension] = a.decisions;
    assert.equal(extension.decidedByLabel, 'In OneTrust');
  });

  it('refuses what the deadline cannot be worked out from, and what the entity cannot answer', async () => {
    const w = await world('import-dsr-refusals');
    const { preview, rows } = await imported(
      w.org.id,
      [
        `${HEADER},Law`,
        `R-1,Alex Example,,Access,${daysAgo(20)},,,,yes,,`,
        `R-2,Sam Example,,Access,${daysAgo(20)},Closed,,,,,`,
        `R-3,Jo Example,,Access,${daysAgo(20)},,,,,,EU`,
        `R-4,Lee Example,,Telepathy,${daysAgo(20)},,,,,,`
      ].join('\n')
    );
    assert.deepEqual(preview, { refuse: 4 });
    assert.match(rows[0].reason ?? '', /extended, but not when/);
    assert.match(rows[1].reason ?? '', /no date it was closed/);
    assert.match(rows[2].reason ?? '', /subject to UK law only/);
    assert.match(rows[3].reason ?? '', /"Telepathy" is not a right/);
  });

  it('leaves out closed requests that ended before the retention cut-off', async () => {
    const w = await world('import-dsr-retention');
    const { preview, rows } = await imported(
      w.org.id,
      [
        HEADER,
        'R-1,Alex Example,,Access,2019-01-01,Completed,2019-01-20,,,',
        'R-2,Sam Example,,Access,2024-06-01,Completed,2024-06-15,,,'
      ].join('\n'),
      { closedBefore: '2020-01-01' }
    );
    assert.deepEqual(preview, { skip: 1, create: 1 });
    assert.match(rows[0].reason ?? '', /before the retention cut-off/);
    assert.equal((await requestsOf(w.org.id)).length, 1);
  });

  it('counts imported requests in the summary, and one closed without a response date as neither on time nor late', async () => {
    const w = await world('import-dsr-metrics');
    await imported(
      w.org.id,
      [
        HEADER,
        `R-1,Alex Example,,Access,${daysAgo(40)},Withdrawn,,${daysAgo(30)},,`,
        `R-2,Sam Example,,Access,${daysAgo(40)},Completed,${daysAgo(35)},,,`
      ].join('\n')
    );
    const m = await requestMetrics(w.org.id, null);
    assert.equal(m.totals.received, 2);
    assert.equal(m.totals.imported, 2);
    assert.equal(m.totals.onTime, 1);
    assert.equal(m.totals.late, 0);
  });

  it('is undone with the decisions it made, and not once a decision is recorded here', async () => {
    const w = await world('import-dsr-undo');
    const first = await imported(
      w.org.id,
      [
        HEADER,
        `R-1,Alex Example,,Access,${daysAgo(20)},,,,yes,${daysAgo(5)}`
      ].join('\n')
    );
    await undoImport({
      organisationId: w.org.id,
      batchId: first.batch.id,
      actor: SYSTEM
    });
    assert.equal((await requestsOf(w.org.id)).length, 0);

    const second = await imported(
      w.org.id,
      [
        HEADER,
        `R-1,Alex Example,,Access,${daysAgo(20)},,,,yes,${daysAgo(5)}`
      ].join('\n')
    );
    const [request] = await requestsOf(w.org.id);
    await recordRequestDecision({
      organisationId: w.org.id,
      requestId: request.id,
      kind: 'other',
      rationale: 'Called the requester.',
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
    assert.equal(
      (
        await db
          .select()
          .from(dataSubjectRequestDecisions)
          .where(eq(dataSubjectRequestDecisions.requestId, request.id))
      ).length,
      2
    );
  });

  it('keeps none of the other columns, and takes a closed one with only its response dated as answered', async () => {
    const w = await world('import-dsr-minimal');
    await imported(
      w.org.id,
      [
        'ID,Requester,Rights,Received on,Status,Responded on,Date of birth,Postal address',
        'R-1,Alex Example,Access,2024-03-01,Closed,2024-03-20,1980-01-01,1 High Street'
      ].join('\n')
    );
    const [request] = await requestsOf(w.org.id);
    assert.deepEqual(request.legacy, {});
    assert.equal(request.status, 'responded');
    assert.equal(request.respondedAt?.toISOString().slice(0, 10), '2024-03-20');
  });

  it('refuses a retention cut-off that is not a date', async () => {
    const w = await world('import-dsr-bad-cutoff');
    const batch = await uploadImport({
      organisationId: w.org.id,
      recordType: 'data_subject_request',
      sourceName: 'OneTrust',
      filename: 'requests.csv',
      contentType: 'text/csv',
      bytes: new TextEncoder().encode(
        `${HEADER}\nR-1,Alex Example,,Access,2024-03-01,,,,,\n`
      ),
      actor: SYSTEM
    });
    const { mapping } = (await loadImport(batch.id, w.org.id))!;
    await assert.rejects(
      previewImport({
        organisationId: w.org.id,
        batchId: batch.id,
        mapping: { ...mapping, closedBefore: '2024-02-31' },
        actor: SYSTEM
      }),
      refused(/is not a date/)
    );
  });

  it('updates on a second import without doubling its decisions, after confirmation too, but not once worked on here', async () => {
    const w = await world('import-dsr-again');
    const file = [
      HEADER,
      `R-1,Alex Example,,Access,${daysAgo(20)},,,,yes,${daysAgo(5)}`
    ].join('\n');
    await imported(w.org.id, file);
    const [request] = await requestsOf(w.org.id);
    await confirmImportedRecord({
      organisationId: w.org.id,
      type: 'data_subject_request',
      id: request.id,
      actor: SYSTEM
    });
    const again = await imported(
      w.org.id,
      file.replace('Alex Example', 'Alex Q. Example')
    );
    assert.deepEqual(again.preview, { update: 1 });
    // Not counted again: its tasks were raised when it first came in.
    assert.deepEqual(again.notes, { overdue: 0 });
    const decisions = () =>
      db
        .select()
        .from(dataSubjectRequestDecisions)
        .where(eq(dataSubjectRequestDecisions.requestId, request.id));
    assert.equal((await decisions()).length, 1);
    assert.equal(
      (await requestsOf(w.org.id))[0].requesterName,
      'Alex Q. Example'
    );

    await recordRequestDecision({
      organisationId: w.org.id,
      requestId: request.id,
      kind: 'other',
      rationale: 'Called the requester.',
      actor: SYSTEM
    });
    const third = await imported(w.org.id, file);
    assert.equal(third.rows[0].action, 'refuse');
    assert.match(third.rows[0].reason ?? '', /worked on here since/);
  });

  it('refuses Part 3 for an entity that is not a competent authority, and waits on identity asked for', async () => {
    const w = await world('import-dsr-part3');
    const { preview, rows } = await imported(
      w.org.id,
      [
        'ID,Requester,Rights,Received on,Regime,Identity requested',
        `R-1,Alex Example,Access,${daysAgo(20)},Part 3,`,
        `R-2,Sam Example,Access,${daysAgo(90)},,${daysAgo(85)}`
      ].join('\n')
    );
    assert.equal(rows[0].action, 'refuse');
    assert.match(rows[0].reason ?? '', /not marked as one/);
    assert.equal(preview.create, 1);
    const [waiting] = await requestsOf(w.org.id);
    assert.equal(waiting.status, 'verifying');
    const loaded = (await loadRequest(waiting.id, w.org.id))!;
    assert.equal(loaded.clock.state, 'waiting');
  });
});
