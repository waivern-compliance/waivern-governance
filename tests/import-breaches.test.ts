import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';

import { db, sql as pg } from '@/db/client';
import {
  breachDecisions,
  breaches,
  entities,
  notifications,
  organisations,
  webhookDeliveries
} from '@/db/schema';
import type { ImportMapping } from '@/lib/import/types';
import { loadBreach, recordBreach, recordDecision } from '@/services/breaches';
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
  actorLabel: 'breach import test'
};

after(() => pg.end());

const refused = (pattern: RegExp) => (e: unknown) =>
  e instanceof ImportRefused && pattern.test(e.message);

const daysAgo = (n: number) =>
  new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

async function world(
  label: string,
  law: 'uk' | 'eu' | 'uk_eu' = 'uk',
  publicCommsProvider = false
) {
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
      dataProtectionLaw: law,
      publicCommsProvider
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
    recordType: 'breach',
    sourceName: 'OneTrust',
    filename: 'breaches.csv',
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

const breachesOf = (organisationId: string) =>
  db
    .select()
    .from(breaches)
    .where(eq(breaches.organisationId, organisationId))
    .orderBy(breaches.externalRef);

const decisionsOf = (breachId: string) =>
  db
    .select()
    .from(breachDecisions)
    .where(eq(breachDecisions.breachId, breachId));

const HEADER =
  'ID,Title,Discovered on,Status,Reported to regulator,Authority notified on,Closed on';

describe('importing breaches', () => {
  it('keeps their real dates: an old closed one raises nothing, an open one never notified is overdue and counted first', async () => {
    const w = await world('import-breach-clocks');
    const { preview, notes } = await imported(
      w.org.id,
      [
        HEADER,
        'B-1,Lost laptop,2021-03-01,Closed,Yes,2021-03-02,2021-04-01',
        `B-2,Email to wrong person,${daysAgo(10)},Investigating,,,`,
        `B-3,Printer left on,${daysAgo(10)},,No,,`
      ].join('\n')
    );
    assert.deepEqual(preview, { create: 3 });
    assert.deepEqual(notes, { overdue: 1 });

    const [old, late, judged] = await breachesOf(w.org.id);
    assert.equal(old.status, 'closed');
    assert.equal(old.discoveredAt.toISOString().slice(0, 10), '2021-03-01');
    assert.equal(old.reference.startsWith('BR-'), true);
    assert.equal(late.status, 'assessing');
    assert.equal(judged.status, 'assessing');
    assert.equal(old.importConfirmedAt, null);

    const [notified] = await decisionsOf(old.id);
    assert.equal(notified.kind, 'supervisory_authority');
    assert.equal(notified.outcome, 'done');
    assert.equal(notified.authorityCode, 'gb-ico');
    assert.equal(
      notified.completedAt?.toISOString().slice(0, 10),
      '2021-03-02'
    );
    assert.equal(notified.decidedByLabel, 'In OneTrust');
    const [notRequired] = await decisionsOf(judged.id);
    assert.equal(notRequired.outcome, 'not_required');

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

    // The sweep reads their clocks as for any breach: one task, for B-2.
    assert.equal((await sweepOrganisation(w.org.id)).breachDeadlinesRaised, 1);

    // Confirming it is a person checking it, not a decision about it.
    await confirmImportedRecord({
      organisationId: w.org.id,
      type: 'breach',
      id: old.id,
      actor: SYSTEM
    });
    const [confirmed] = await breachesOf(w.org.id);
    assert.ok(confirmed.importConfirmedAt);
  });

  it('runs the same clock as a breach recorded here with the same dates', async () => {
    const w = await world('import-breach-same');
    const discovered = daysAgo(20);
    const told = daysAgo(15);
    await imported(
      w.org.id,
      [HEADER, `B-1,Lost laptop,${discovered},,Yes,${told},`].join('\n')
    );
    const [mine] = await breachesOf(w.org.id);
    const typed = await recordBreach({
      organisationId: w.org.id,
      entityId: w.entity.id,
      title: 'Lost laptop',
      description: 'Left on a train.',
      discoveredAt: new Date(discovered),
      actor: SYSTEM
    });
    await recordDecision({
      organisationId: w.org.id,
      breachId: typed.id,
      kind: 'supervisory_authority',
      outcome: 'done',
      rationale: 'Reported online.',
      completedAt: new Date(told),
      actor: SYSTEM
    });
    const a = (await loadBreach(mine.id, w.org.id))!;
    const b = (await loadBreach(typed.id, w.org.id))!;
    assert.equal(a.clock.state, 'met');
    assert.equal(a.clock.state, b.clock.state);
    assert.equal(a.clock.words, b.clock.words);
    assert.equal(a.breach.status, b.breach.status);
  });

  it('refuses what its clocks cannot be worked out from, and what the entity cannot answer', async () => {
    const w = await world('import-breach-refusals');
    const { preview, rows } = await imported(
      w.org.id,
      [
        `${HEADER},Law,Breach type,PECR`,
        `B-1,Told,${daysAgo(20)},,Yes,,,,,`,
        `B-2,Closed,${daysAgo(20)},Closed,,,,,,`,
        `B-3,EU,${daysAgo(20)},,,,,EU,,`,
        `B-4,Odd,${daysAgo(20)},,,,,,Embarrassment,`,
        `B-5,Telecoms,${daysAgo(20)},,,,,,,Yes`
      ].join('\n')
    );
    assert.deepEqual(preview, { refuse: 5 });
    assert.match(rows[0].reason ?? '', /notified, but not when/);
    assert.match(rows[1].reason ?? '', /no date it was closed/);
    assert.match(rows[2].reason ?? '', /subject to the UK GDPR only/);
    assert.match(rows[3].reason ?? '', /"Embarrassment" is not a kind/);
    assert.match(rows[4].reason ?? '', /not marked as one/);
  });

  it('asks which authority was told where more than one is owed', async () => {
    const w = await world('import-breach-authorities', 'uk_eu');
    const { preview, rows } = await imported(
      w.org.id,
      [
        `${HEADER},Law,Authority`,
        `B-1,Both,${daysAgo(20)},,Yes,${daysAgo(19)},,Both,`,
        `B-2,Both named,${daysAgo(20)},,Yes,${daysAgo(19)},,Both,ICO`
      ].join('\n')
    );
    assert.deepEqual(preview, { refuse: 1, create: 1 });
    assert.match(rows[0].reason ?? '', /more than one authority/);
    const [named] = await breachesOf(w.org.id);
    const [decision] = await decisionsOf(named.id);
    assert.equal(decision.authorityCode, 'gb-ico');
  });

  it('refuses a status its dates contradict, and dates out of order', async () => {
    const w = await world('import-breach-order');
    const { preview, rows } = await imported(
      w.org.id,
      [
        HEADER,
        `B-1,Still open,${daysAgo(20)},Investigating,,,${daysAgo(5)}`,
        `B-2,Told early,${daysAgo(20)},,Yes,${daysAgo(25)},`,
        `B-3,Closed early,${daysAgo(20)},,No,,${daysAgo(30)}`
      ].join('\n')
    );
    assert.deepEqual(preview, { refuse: 3 });
    assert.match(
      rows[0].reason ?? '',
      /assessing there, but gives a date it was closed/
    );
    assert.match(
      rows[1].reason ?? '',
      /authority was notified before it was discovered/
    );
    assert.match(rows[2].reason ?? '', /closed before it was discovered/);
  });

  it('is notified only once every authority owed is told, as here', async () => {
    const w = await world('import-breach-partly', 'uk_eu');
    await imported(
      w.org.id,
      [
        `${HEADER},Law,Authority`,
        `B-1,Both,${daysAgo(20)},,Yes,${daysAgo(19)},,Both,ICO`
      ].join('\n')
    );
    const [breach] = await breachesOf(w.org.id);
    assert.equal(breach.status, 'assessing');
  });

  it('keeps a judgement that the people affected did not need telling', async () => {
    const w = await world('import-breach-subjects');
    await imported(
      w.org.id,
      [
        `${HEADER},Individuals notified,Reason individuals not notified`,
        `B-1,Encrypted laptop,${daysAgo(20)},,No,,,No,The disk was encrypted.`
      ].join('\n')
    );
    const [breach] = await breachesOf(w.org.id);
    const subjects = (await decisionsOf(breach.id)).find(
      (d) => d.kind === 'data_subjects'
    );
    assert.equal(subjects?.outcome, 'not_required');
    assert.equal(subjects?.rationale, 'The disk was encrypted.');
  });

  it('adds a notification the source recorded since, and refuses one it now tells differently', async () => {
    const w = await world('import-breach-later');
    const discovered = daysAgo(20);
    const row = (told: string) =>
      [HEADER, `B-1,Lost laptop,${discovered},,${told},`].join('\n');
    const first = await imported(w.org.id, row(','));
    assert.deepEqual(first.notes, { overdue: 1 });
    const second = await imported(w.org.id, row(`Yes,${daysAgo(15)}`));
    assert.deepEqual(second.preview, { update: 1 });
    const [breach] = await breachesOf(w.org.id);
    assert.equal(breach.status, 'notified');
    const [notified] = await decisionsOf(breach.id);
    assert.equal(notified.importBatchId, second.batch.id);
    const loaded = (await loadBreach(breach.id, w.org.id))!;
    assert.equal(loaded.clock.state, 'met');

    const third = await imported(w.org.id, row(`Yes,${daysAgo(14)}`));
    assert.deepEqual(third.preview, { refuse: 1 });
    assert.match(
      third.rows[0].reason ?? '',
      /something different about who was told/
    );

    // Undoing the import that added it takes the notification away again.
    await undoImport({
      organisationId: w.org.id,
      batchId: second.batch.id,
      actor: SYSTEM
    });
    assert.equal((await decisionsOf(breach.id)).length, 0);
  });

  it('leaves out breaches closed before the retention cut-off', async () => {
    const w = await world('import-breach-retention');
    const { preview, rows } = await imported(
      w.org.id,
      [
        HEADER,
        'B-1,Old,2019-01-01,Closed,No,,2019-02-01',
        'B-2,Newer,2024-06-01,Closed,No,,2024-07-01'
      ].join('\n'),
      { closedBefore: '2020-01-01' }
    );
    assert.deepEqual(preview, { skip: 1, create: 1 });
    assert.match(rows[0].reason ?? '', /before the retention cut-off/);
    assert.equal((await breachesOf(w.org.id)).length, 1);
  });

  it('is undone with the decisions it made, and not once a decision is recorded here', async () => {
    const w = await world('import-breach-undo');
    const file = [
      HEADER,
      `B-1,Lost laptop,${daysAgo(20)},,Yes,${daysAgo(19)},`
    ].join('\n');
    const first = await imported(w.org.id, file);
    await undoImport({
      organisationId: w.org.id,
      batchId: first.batch.id,
      actor: SYSTEM
    });
    assert.equal((await breachesOf(w.org.id)).length, 0);

    const second = await imported(w.org.id, file);
    const [breach] = await breachesOf(w.org.id);
    await recordDecision({
      organisationId: w.org.id,
      breachId: breach.id,
      kind: 'insurer',
      outcome: 'done',
      rationale: 'Told the insurer.',
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
    assert.equal((await decisionsOf(breach.id)).length, 2);
  });

  it('updates on a second import without doubling its decisions, keeps no other columns, and is not written over once worked on here', async () => {
    const w = await world('import-breach-again');
    const file = (title: string) =>
      [
        `${HEADER},Reporter's home address`,
        `B-1,${title},${daysAgo(20)},,Yes,${daysAgo(19)},,1 High Street`
      ].join('\n');
    await imported(w.org.id, file('Lost laptop'));
    const again = await imported(w.org.id, file('Lost laptop on a train'));
    assert.deepEqual(again.preview, { update: 1 });
    const [breach] = await breachesOf(w.org.id);
    assert.equal(breach.title, 'Lost laptop on a train');
    assert.deepEqual(breach.legacy, {});
    assert.equal((await decisionsOf(breach.id)).length, 1);

    await recordDecision({
      organisationId: w.org.id,
      breachId: breach.id,
      kind: 'insurer',
      outcome: 'done',
      rationale: 'Told the insurer.',
      actor: SYSTEM
    });
    const third = await imported(w.org.id, file('Lost laptop'));
    assert.deepEqual(third.preview, { refuse: 1 });
    assert.match(third.rows[0].reason ?? '', /worked on here/);
  });
});
