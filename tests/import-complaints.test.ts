import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';

import { db, sql as pg } from '@/db/client';
import {
  dataProtectionComplaintEvents,
  dataProtectionComplaints,
  entities,
  notifications,
  organisations,
  tasks,
  webhookDeliveries
} from '@/db/schema';
import type { RecordType } from '@/lib/import/fields';
import type { ImportMapping } from '@/lib/import/types';
import {
  complaintsSummary,
  loadComplaint,
  recordComplaint,
  recordComplaintEvent
} from '@/services/complaints';
import { recordRequest } from '@/services/data-subject-requests';
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
  actorLabel: 'complaint import test'
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
  extra: Partial<ImportMapping> = {},
  recordType: RecordType = 'data_protection_complaint'
) {
  const batch = await uploadImport({
    organisationId,
    recordType,
    sourceName: 'OneTrust',
    filename: 'complaints.csv',
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

const complaintsOf = (organisationId: string) =>
  db
    .select()
    .from(dataProtectionComplaints)
    .where(eq(dataProtectionComplaints.organisationId, organisationId))
    .orderBy(dataProtectionComplaints.externalRef);

const complaintTasksOf = (organisationId: string) =>
  and(
    eq(tasks.organisationId, organisationId),
    eq(tasks.subjectType, 'data_protection_complaint')
  );

const stepsOf = (complaintId: string) =>
  db
    .select()
    .from(dataProtectionComplaintEvents)
    .where(eq(dataProtectionComplaintEvents.complaintId, complaintId))
    .orderBy(dataProtectionComplaintEvents.occurredAt);

const HEADER =
  'ID,Complainant,Received on,Status,Acknowledged on,Outcome,Outcome sent on,Closed on';

describe('importing complaints', () => {
  it('keeps their real dates: an old closed one raises nothing, an open one never acknowledged is overdue and counted first', async () => {
    const w = await world('import-complaint-clocks');
    const { preview, notes } = await imported(
      w.org.id,
      [
        HEADER,
        'C-1,Alex Example,2025-01-10,Closed,,Upheld,2025-02-01,2025-02-05',
        `C-2,Sam Example,${daysAgo(40)},,,,,`,
        `C-3,Jo Example,${daysAgo(10)},,${daysAgo(9)},,,`,
        `C-4,Lee Example,${daysAgo(20)},Withdrawn,,,,${daysAgo(15)}`
      ].join('\n')
    );
    assert.deepEqual(preview, { create: 4 });
    assert.deepEqual(notes, { overdue: 1 });

    const [old, late, acked, gone] = await complaintsOf(w.org.id);
    assert.equal(old.status, 'closed');
    assert.equal(old.outcome, 'upheld');
    assert.equal(old.reference.startsWith('CMP-'), true);
    // Sending the outcome acknowledged it, as recording it here does.
    assert.equal(old.acknowledgedAt?.toISOString().slice(0, 10), '2025-02-01');
    assert.equal(late.status, 'received');
    assert.equal(acked.status, 'acknowledged');
    assert.equal(gone.status, 'withdrawn');
    assert.equal(old.importConfirmedAt, null);

    const steps = await stepsOf(old.id);
    assert.deepEqual(
      steps.map((s) => s.kind),
      ['outcome_sent']
    );
    assert.equal(steps[0].recordedByLabel, 'In OneTrust');
    assert.deepEqual(
      (await stepsOf(gone.id)).map((s) => s.kind),
      ['withdrawn']
    );

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

    // The sweep reads their clocks as for any complaint: tasks for C-2 only,
    // past both the 30 days and the outcome target.
    assert.equal(
      (await sweepOrganisation(w.org.id)).complaintDeadlinesRaised,
      2
    );

    await confirmImportedRecord({
      organisationId: w.org.id,
      type: 'data_protection_complaint',
      id: old.id,
      actor: SYSTEM
    });
    const [confirmed] = await complaintsOf(w.org.id);
    assert.ok(confirmed.importConfirmedAt);

    // They count in the complaints summary, marked as imported.
    const summary = await complaintsSummary({ organisationId: w.org.id });
    assert.equal(summary.totals.imported, 3);
  });

  it('runs the same clock as a complaint recorded here with the same dates', async () => {
    const w = await world('import-complaint-same');
    const received = daysAgo(40);
    const acknowledged = daysAgo(35);
    await imported(
      w.org.id,
      [HEADER, `C-1,Alex Example,${received},,${acknowledged},,,`].join('\n')
    );
    const [mine] = await complaintsOf(w.org.id);
    const typed = await recordComplaint({
      organisationId: w.org.id,
      entityId: w.entity.id,
      channel: 'email',
      receivedAt: new Date(received),
      subject: 'other',
      description: 'Unhappy.',
      complainantName: 'Alex Example',
      actor: SYSTEM
    });
    await recordComplaintEvent({
      organisationId: w.org.id,
      complaintId: typed.id,
      kind: 'acknowledged',
      note: '',
      channel: 'email',
      at: new Date(acknowledged),
      actor: SYSTEM
    });
    const a = (await loadComplaint(mine.id, w.org.id))!;
    const b = (await loadComplaint(typed.id, w.org.id))!;
    for (const dial of ['acknowledgement', 'outcome', 'update'] as const) {
      assert.equal(a.clock[dial].state, b.clock[dial].state);
      assert.equal(a.clock[dial].words, b.clock[dial].words);
    }
    assert.equal(a.complaint.status, b.complaint.status);
  });

  it('refuses what its clocks cannot be worked out from, and what its status contradicts', async () => {
    const w = await world('import-complaint-refusals');
    const { preview, rows } = await imported(
      w.org.id,
      [
        `${HEADER},Law,Last progress update`,
        `C-1,A,${daysAgo(20)},,,Upheld,,,,`,
        `C-2,B,${daysAgo(20)},,,,${daysAgo(5)},,,`,
        `C-3,C,${daysAgo(20)},Closed,,,,${daysAgo(5)},,`,
        `C-4,D,${daysAgo(20)},Investigating,,Upheld,${daysAgo(5)},,,`,
        `C-5,E,${daysAgo(20)},,${daysAgo(25)},,,,,`,
        `C-6,F,${daysAgo(20)},,,,,,EU,`,
        `C-7,G,${daysAgo(20)},,,Upheld,${daysAgo(10)},,,${daysAgo(5)}`,
        `C-8,H,${daysAgo(20)},Withdrawn,,Upheld,${daysAgo(10)},${daysAgo(5)},,`,
        `C-9,I,${daysAgo(20)},,,Passed to controller,${daysAgo(10)},,,`,
        `C-10,J,${daysAgo(20)},Received,${daysAgo(19)},,,,,`
      ].join('\n')
    );
    assert.deepEqual(preview, { refuse: 10 });
    assert.match(rows[0].reason ?? '', /gives the outcome, but not when/);
    assert.match(rows[1].reason ?? '', /but not what it was/);
    assert.match(rows[2].reason ?? '', /gives no outcome/);
    assert.match(
      rows[3].reason ?? '',
      /being investigated there, but gives a date the outcome/
    );
    assert.match(rows[4].reason ?? '', /acknowledged before it arrived/);
    assert.match(rows[5].reason ?? '', /subject to UK law only/);
    assert.match(rows[6].reason ?? '', /last updated after the outcome/);
    assert.match(
      rows[7].reason ?? '',
      /An answered complaint was not withdrawn/
    );
    assert.match(rows[8].reason ?? '', /As the controller/);
    assert.match(
      rows[9].reason ?? '',
      /received there, but gives a date it was acknowledged/
    );
  });

  it('links the request it is about, by its ID there or its reference here', async () => {
    const w = await world('import-complaint-request');
    await imported(
      w.org.id,
      [
        'ID,Requester,Rights,Received on',
        `R-1,Alex Example,Access,${daysAgo(60)}`
      ].join('\n'),
      {},
      'data_subject_request'
    );
    const typed = await recordRequest({
      organisationId: w.org.id,
      entityId: w.entity.id,
      requesterName: 'Jo Example',
      rights: ['access'],
      channel: 'email',
      receivedAt: new Date(daysAgo(30)),
      description: 'Everything you hold.',
      actor: SYSTEM
    });
    const { preview, rows } = await imported(
      w.org.id,
      [
        `${HEADER},Request ID`,
        `C-1,Alex Example,${daysAgo(10)},,,,,,R-1`,
        `C-2,Sam Example,${daysAgo(10)},,,,,,R-404`,
        `C-3,Jo Example,${daysAgo(10)},,,,,,${typed.reference.toLowerCase()}`
      ].join('\n')
    );
    assert.deepEqual(preview, { create: 2, refuse: 1 });
    assert.match(rows[1].reason ?? '', /not a request in Govern/);
    const [byId, byReference] = await complaintsOf(w.org.id);
    assert.ok((await loadComplaint(byId.id, w.org.id))!.request);
    assert.equal(byReference.requestId, typed.id);
  });

  it('leaves out complaints closed before the retention cut-off', async () => {
    const w = await world('import-complaint-retention');
    const { preview, rows } = await imported(
      w.org.id,
      [
        HEADER,
        'C-1,Old,2019-01-01,Closed,,Not upheld,2019-01-20,2019-02-01',
        'C-2,Newer,2024-06-01,Closed,,Not upheld,2024-06-20,2024-07-01'
      ].join('\n'),
      { closedBefore: '2020-01-01' }
    );
    assert.deepEqual(preview, { skip: 1, create: 1 });
    assert.match(rows[0].reason ?? '', /before the retention cut-off/);
    assert.equal((await complaintsOf(w.org.id)).length, 1);
  });

  it('takes away the deadline tasks the sweep raised for it when undone, unless one was picked up', async () => {
    const w = await world('import-complaint-undo-tasks');
    const file = [HEADER, `C-1,Alex Example,${daysAgo(40)},,,,,`].join('\n');
    const first = await imported(w.org.id, file);
    assert.equal(
      (await sweepOrganisation(w.org.id)).complaintDeadlinesRaised,
      2
    );
    await undoImport({
      organisationId: w.org.id,
      batchId: first.batch.id,
      actor: SYSTEM
    });
    assert.equal((await complaintsOf(w.org.id)).length, 0);
    assert.equal(
      (await db.select().from(tasks).where(complaintTasksOf(w.org.id))).length,
      0
    );

    const second = await imported(w.org.id, file);
    await sweepOrganisation(w.org.id);
    const [task] = await db
      .select()
      .from(tasks)
      .where(complaintTasksOf(w.org.id));
    await db
      .update(tasks)
      .set({ status: 'in_progress' })
      .where(eq(tasks.id, task.id));
    await assert.rejects(
      undoImport({
        organisationId: w.org.id,
        batchId: second.batch.id,
        actor: SYSTEM
      }),
      refused(/worked on through a task or a comment/)
    );
  });

  it('marks a late acknowledgement or outcome as late, and keeps a delay reason only where it was', async () => {
    const w = await world('import-complaint-late');
    await imported(
      w.org.id,
      [
        `${HEADER},Reason for delay`,
        `C-1,Alex Example,${daysAgo(80)},,${daysAgo(30)},,,,`,
        `C-2,Sam Example,${daysAgo(30)},,${daysAgo(29)},Upheld,${daysAgo(20)},,Short-staffed`
      ].join('\n')
    );
    const [late, inTime] = await complaintsOf(w.org.id);
    assert.equal(
      late.acknowledgementLateReason,
      'OneTrust recorded no reason.'
    );
    assert.equal(inTime.outcomeLateReason, null);
  });

  it('is undone with the steps it made, and not once a step is recorded here', async () => {
    const w = await world('import-complaint-undo');
    const file = [
      HEADER,
      `C-1,Alex Example,${daysAgo(20)},,${daysAgo(19)},,,`
    ].join('\n');
    const first = await imported(w.org.id, file);
    await undoImport({
      organisationId: w.org.id,
      batchId: first.batch.id,
      actor: SYSTEM
    });
    assert.equal((await complaintsOf(w.org.id)).length, 0);

    const second = await imported(w.org.id, file);
    const [complaint] = await complaintsOf(w.org.id);
    await recordComplaintEvent({
      organisationId: w.org.id,
      complaintId: complaint.id,
      kind: 'enquiry',
      note: 'Asked the marketing team.',
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
    assert.equal((await stepsOf(complaint.id)).length, 2);
  });

  it('adds a later update on a second import, keeps no other columns, refuses a step dated differently, and is not written over once worked on here', async () => {
    const w = await world('import-complaint-again');
    const received = daysAgo(50);
    const file = (acknowledged: string, update: string) =>
      [
        `${HEADER},Last progress update,Complainant's home address`,
        `C-1,Alex Example,${received},,${acknowledged},,,,${update},1 High Street`
      ].join('\n');
    await imported(w.org.id, file(daysAgo(45), daysAgo(30)));
    const again = await imported(w.org.id, file(daysAgo(45), daysAgo(5)));
    assert.deepEqual(again.preview, { update: 1 });
    const [complaint] = await complaintsOf(w.org.id);
    assert.deepEqual(complaint.legacy, {});
    const steps = await stepsOf(complaint.id);
    assert.deepEqual(
      steps.map((s) => s.kind),
      ['acknowledged', 'progress_update', 'progress_update']
    );
    assert.equal(steps[2].importBatchId, again.batch.id);

    const earlier = await imported(w.org.id, file(daysAgo(45), daysAgo(10)));
    assert.deepEqual(earlier.preview, { refuse: 1 });

    const moved = await imported(w.org.id, file(daysAgo(44), daysAgo(5)));
    assert.deepEqual(moved.preview, { refuse: 1 });
    assert.match(
      moved.rows[0].reason ?? '',
      /something different about when the complainant heard/
    );

    await recordComplaintEvent({
      organisationId: w.org.id,
      complaintId: complaint.id,
      kind: 'enquiry',
      note: 'Asked the marketing team.',
      actor: SYSTEM
    });
    const third = await imported(w.org.id, file(daysAgo(45), daysAgo(5)));
    assert.deepEqual(third.preview, { refuse: 1 });
    assert.match(third.rows[0].reason ?? '', /worked on here/);
  });
});
