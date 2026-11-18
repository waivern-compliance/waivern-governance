import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';

import { db, sql as pg } from '@/db/client';
import { breaches, entities, organisations, tasks } from '@/db/schema';
import { verifyAuditChain } from '@/lib/audit';
import {
  breachRegister,
  loadBreach,
  reclassifyBreach,
  recordBreach,
  recordDecision
} from '@/services/breaches';
import {
  commitImport,
  loadImport,
  previewImport,
  uploadImport
} from '@/services/imports';
import { sweepOrganisation } from '@/services/sweep';

const SYSTEM = {
  actorKind: 'system' as const,
  actorUserId: null,
  actorLabel: 'near miss test'
};
const HOUR = 3_600_000;

after(() => pg.end());

async function world(label: string, publicCommsProvider = false) {
  const [org] = await db
    .insert(organisations)
    .values({
      name: `Near miss ${label}`,
      slug: `nm-${label}-${crypto.randomUUID().slice(0, 8)}`
    })
    .returning();
  const [entity] = await db
    .insert(entities)
    .values({
      organisationId: org.id,
      name: 'Main',
      isDefault: true,
      publicCommsProvider
    })
    .returning();
  return { org, entity };
}

type World = Awaited<ReturnType<typeof world>>;

const incident = (
  w: World,
  classification: 'breach' | 'near_miss',
  hoursAgo = 100
) =>
  recordBreach({
    organisationId: w.org.id,
    entityId: w.entity.id,
    title: 'Email to the wrong person',
    description: 'Recalled before it was opened.',
    classification,
    discoveredAt: new Date(Date.now() - hoursAgo * HOUR),
    actor: SYSTEM
  });

const deadlineTasks = (w: World, breachId: string) =>
  db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.organisationId, w.org.id),
        eq(tasks.type, 'breach_deadline'),
        eq(tasks.subjectId, breachId)
      )
    );

describe('near misses', () => {
  it('runs no clock and owes no notification, even long past seventy-two hours', async () => {
    const w = await world('clock', true);
    const nearMiss = await incident(w, 'near_miss');
    const loaded = (await loadBreach(nearMiss.id, w.org.id))!;
    assert.equal(loaded.clock.state, 'not_applicable');
    assert.deepEqual(loaded.obligations, []);
    assert.deepEqual(loaded.authorityClocks, []);
    assert.deepEqual(loaded.outstandingContent, []);
    assert.equal(loaded.pecr, null, 'nor PECR reg 5A for a provider');

    await sweepOrganisation(w.org.id);
    assert.equal((await deadlineTasks(w, nearMiss.id)).length, 0);
  });

  it('refuses a statutory notification but records what was chosen', async () => {
    const w = await world('decisions');
    const nearMiss = await incident(w, 'near_miss');
    await assert.rejects(
      recordDecision({
        organisationId: w.org.id,
        breachId: nearMiss.id,
        kind: 'supervisory_authority',
        outcome: 'done',
        rationale: 'Told them anyway.',
        actor: SYSTEM
      }),
      /near miss owes no notification/
    );
    const told = await recordDecision({
      organisationId: w.org.id,
      breachId: nearMiss.id,
      kind: 'insurer',
      outcome: 'done',
      rationale: 'The policy asks for incidents as well as breaches.',
      actor: SYSTEM
    });
    assert.equal(told.kind, 'insurer');
  });

  it('counts near misses on the register, and never as unassessed', async () => {
    const w = await world('register');
    await incident(w, 'near_miss');
    await incident(w, 'breach', 1);
    const register = await breachRegister(w.org.id, null);
    assert.equal(register.total, 2);
    assert.equal(register.nearMisses, 1);
    assert.equal(register.unassessed, 1);
  });

  it('becomes a breach counted from its discovery unless a later date is given', async () => {
    const w = await world('to-breach');
    const fromDiscovery = await incident(w, 'near_miss');
    await reclassifyBreach({
      organisationId: w.org.id,
      breachId: fromDiscovery.id,
      classification: 'breach',
      rationale: 'The recipient opened it.',
      actor: SYSTEM
    });
    const overdue = (await loadBreach(fromDiscovery.id, w.org.id))!;
    assert.equal(overdue.breach.classification, 'breach');
    assert.equal(overdue.breach.awareAt, null);
    assert.equal(overdue.clock.state, 'overdue');
    await sweepOrganisation(w.org.id);
    const [task] = await deadlineTasks(w, fromDiscovery.id);
    assert.equal(
      task.dueAt?.getTime(),
      fromDiscovery.discoveredAt.getTime() + 72 * HOUR
    );

    const later = await incident(w, 'near_miss');
    const awareAt = new Date(Date.now() - 2 * HOUR);
    await reclassifyBreach({
      organisationId: w.org.id,
      breachId: later.id,
      classification: 'breach',
      rationale: 'The recipient told us today that they had opened it.',
      awareAt,
      actor: SYSTEM
    });
    const running = (await loadBreach(later.id, w.org.id))!;
    assert.equal(running.clock.state, 'running');
    assert.equal(
      'dueAt' in running.clock && running.clock.dueAt.getTime(),
      awareAt.getTime() + 72 * HOUR
    );
  });

  it('refuses a reclassification without a reason, or counted from before discovery or from the future', async () => {
    const w = await world('refusals');
    const nearMiss = await incident(w, 'near_miss');
    const attempt = (rationale: string, awareAt?: Date) =>
      reclassifyBreach({
        organisationId: w.org.id,
        breachId: nearMiss.id,
        classification: 'breach',
        rationale,
        awareAt,
        actor: SYSTEM
      });
    await assert.rejects(attempt('  '), /Record why/);
    await assert.rejects(
      attempt('Opened.', new Date(nearMiss.discoveredAt.getTime() - HOUR)),
      /before it was discovered/
    );
    await assert.rejects(
      attempt('Opened.', new Date(Date.now() + HOUR)),
      /in the future/
    );
    await assert.rejects(
      reclassifyBreach({
        organisationId: w.org.id,
        breachId: nearMiss.id,
        classification: 'near_miss',
        rationale: 'Still a near miss.',
        actor: SYSTEM
      }),
      /already recorded as a near miss/
    );
  });

  it('stops the clocks of a breach found to be a near miss, retiring its deadline tasks and keeping what was decided', async () => {
    const w = await world('to-near-miss');
    const breach = await incident(w, 'breach');
    await recordDecision({
      organisationId: w.org.id,
      breachId: breach.id,
      kind: 'supervisory_authority',
      outcome: 'pending',
      rationale: 'Still finding out what was seen.',
      actor: SYSTEM
    });
    await sweepOrganisation(w.org.id);
    assert.equal((await deadlineTasks(w, breach.id))[0].status, 'open');

    await reclassifyBreach({
      organisationId: w.org.id,
      breachId: breach.id,
      classification: 'near_miss',
      rationale: 'The logs show the file was never downloaded.',
      actor: SYSTEM
    });
    const loaded = (await loadBreach(breach.id, w.org.id))!;
    assert.equal(loaded.clock.state, 'not_applicable');
    assert.equal(loaded.decisions.length, 1);
    assert.match(
      loaded.breach.reclassificationRationale ?? '',
      /never downloaded/
    );
    assert.deepEqual(
      (await deadlineTasks(w, breach.id)).map((t) => t.status),
      ['done']
    );
    await sweepOrganisation(w.org.id);
    assert.equal(
      (await deadlineTasks(w, breach.id)).filter((t) => t.status === 'open')
        .length,
      0
    );
    assert.equal((await verifyAuditChain(w.org.id)).ok, true);
  });

  it('imports a near miss with nobody told and no clock, and refuses one that says who was told', async () => {
    const w = await world('import');
    const batch = await uploadImport({
      organisationId: w.org.id,
      recordType: 'breach',
      sourceName: 'OneTrust',
      filename: 'incidents.csv',
      contentType: 'text/csv',
      bytes: new TextEncoder().encode(
        [
          'ID,Title,Discovered on,Classification,Authority notified on',
          `N-1,Email recalled,2026-01-05,Near miss,`,
          `N-2,Parcel returned,2026-01-06,Near-miss,2026-01-07`,
          `N-3,Laptop stolen,2026-01-08,Data breach,`
        ].join('\n')
      ),
      actor: SYSTEM
    });
    const { mapping } = (await loadImport(batch.id, w.org.id))!;
    assert.equal(mapping.fields.classification, 'Classification');
    const preview = await previewImport({
      organisationId: w.org.id,
      batchId: batch.id,
      mapping,
      actor: SYSTEM
    });
    assert.deepEqual(preview, { create: 2, refuse: 1 });
    const { rows, batch: previewed } = (await loadImport(batch.id, w.org.id))!;
    assert.match(rows[1].reason ?? '', /near miss owes no notification/);
    assert.deepEqual(previewed.previewNotes, { overdue: 1 });
    await commitImport({
      organisationId: w.org.id,
      batchId: batch.id,
      actor: SYSTEM
    });

    const imported = await db
      .select()
      .from(breaches)
      .where(eq(breaches.organisationId, w.org.id))
      .orderBy(breaches.externalRef);
    assert.deepEqual(
      imported.map((b) => [b.externalRef, b.classification]),
      [
        ['N-1', 'near_miss'],
        ['N-3', 'breach']
      ]
    );
  });
});
