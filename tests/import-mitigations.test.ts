import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';

import { db, sql as pg } from '@/db/client';
import {
  auditEvents,
  entities,
  memberships,
  mitigations,
  organisations,
  risks,
  users
} from '@/db/schema';
import type { RecordType } from '@/lib/import/fields';
import {
  commitImport,
  confirmImportedRecord,
  ImportRefused,
  loadImport,
  previewImport,
  undoImport,
  uploadImport
} from '@/services/imports';
import { updateMitigation } from '@/services/risks';
import { sweepOrganisation } from '@/services/sweep';

const SYSTEM = {
  actorKind: 'system' as const,
  actorUserId: null,
  actorLabel: 'mitigation import test'
};

after(() => pg.end());

const refused = (pattern: RegExp) => (e: unknown) =>
  e instanceof ImportRefused && pattern.test(e.message);

async function world(label: string) {
  const [org] = await db
    .insert(organisations)
    .values({
      name: label,
      slug: `${label}-${crypto.randomUUID().slice(0, 8)}`
    })
    .returning();
  const [entity] = await db
    .insert(entities)
    .values({ organisationId: org.id, name: 'Main', isDefault: true })
    .returning();
  const [other] = await db
    .insert(entities)
    .values({ organisationId: org.id, name: 'Subsidiary' })
    .returning();
  const [person] = await db
    .insert(users)
    .values({ email: `Owner-${crypto.randomUUID().slice(0, 8)}@example.com` })
    .returning();
  await db
    .insert(memberships)
    .values({ organisationId: org.id, userId: person.id });
  return { org, entity, other, person };
}

/** Upload, preview with the columns as guessed, and import. */
async function imported(
  organisationId: string,
  recordType: RecordType,
  text: string,
  entityId?: string
) {
  const batch = await uploadImport({
    organisationId,
    recordType,
    sourceName: 'OneTrust',
    filename: `${recordType}.csv`,
    contentType: 'text/csv',
    bytes: new TextEncoder().encode(text),
    ...(entityId ? { entityId } : {}),
    actor: SYSTEM
  });
  const { mapping } = (await loadImport(batch.id, organisationId))!;
  const preview = await previewImport({
    organisationId,
    batchId: batch.id,
    mapping,
    actor: SYSTEM
  });
  await commitImport({ organisationId, batchId: batch.id, actor: SYSTEM });
  return {
    batch,
    preview,
    rows: (await loadImport(batch.id, organisationId))!.rows
  };
}

const RISKS = [
  'ID,Title,Description,Likelihood,Impact',
  'R-1,Payroll leak,Payroll file sent to the wrong person,3,3',
  'R-2,Vendor breach,A supplier is breached,2,2'
].join('\n');

const mitigationsOf = (riskId: string) =>
  db
    .select()
    .from(mitigations)
    .where(eq(mitigations.riskId, riskId))
    .orderBy(mitigations.externalRef);

async function riskBy(organisationId: string, externalRef: string) {
  const [risk] = await db
    .select()
    .from(risks)
    .where(
      and(
        eq(risks.organisationId, organisationId),
        eq(risks.externalRef, externalRef)
      )
    );
  return risk;
}

describe('importing mitigations', () => {
  it("lands each on its risk, by the risk's ID there or its reference here", async () => {
    const w = await world('import-mitigations-land');
    await imported(w.org.id, 'risk', RISKS);
    const vendor = await riskBy(w.org.id, 'R-2');
    const { preview, rows } = await imported(
      w.org.id,
      'mitigation',
      [
        'ID,Risk,Description,Treatment,Owner,Due date,Status,Verified by,Verified on',
        `M-1,r-1,Encrypt payroll exports,Reduce,${w.person.email.toUpperCase()},2027-01-31,In progress,,`,
        `M-2,${vendor.reference},Annual supplier audit,Transfer,someone@elsewhere.example,,Verified,A. Auditor,2025-04-01`,
        'M-3,R-9,Nothing to treat,,,,,,',
        'M-4,R-1,Live with the residual,Accept,,,,,'
      ].join('\n')
    );
    assert.deepEqual(preview, { create: 3, refuse: 1 });
    assert.match(
      rows[2].reason ?? '',
      /No risk "R-9" is recorded in this entity/
    );

    const payroll = await riskBy(w.org.id, 'R-1');
    const [encrypt, accepted] = await mitigationsOf(payroll.id);
    assert.equal(encrypt.treatmentType, 'limitation');
    assert.equal(encrypt.ownerId, w.person.id);
    assert.equal(encrypt.status, 'in_progress');
    assert.equal(encrypt.dueAt?.toISOString().slice(0, 10), '2027-01-31');
    assert.equal(encrypt.importConfirmedAt, null);
    // Accepting is decided on the risk here: kept, not refused, not a treatment.
    assert.equal(accepted.treatmentType, null);
    assert.equal(accepted.legacy?.Treatment, 'Accept');

    // Verified there is implemented here, waiting for a second person.
    const [audit] = await mitigationsOf(vendor.id);
    assert.equal(audit.status, 'implemented');
    assert.equal(audit.verifiedAt, null);
    assert.equal(audit.ownerId, null);
    assert.deepEqual(audit.sourceHistory, [
      {
        at: '2025-04-01T00:00:00.000Z',
        what: 'Verified in OneTrust',
        by: 'A. Auditor'
      }
    ]);
    assert.equal(audit.legacy?.Owner, 'someone@elsewhere.example');
    assert.equal(audit.legacy?.Status, 'Verified');

    // Audited as done now, by the person importing, never at the source's dates.
    const events = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organisationId, w.org.id),
          eq(auditEvents.action, 'mitigation.added')
        )
      );
    assert.equal(events.length, 3);
    for (const e of events) {
      assert.equal(e.actorLabel, SYSTEM.actorLabel);
      assert.ok(e.at.getTime() > Date.parse('2026-01-01'));
    }
  });

  it('updates on a second import, keeps a verification given here, and never moves one to another risk', async () => {
    const w = await world('import-mitigations-again');
    await imported(w.org.id, 'risk', RISKS);
    await imported(
      w.org.id,
      'mitigation',
      'ID,Risk,Description,Status\nM-1,R-1,Encrypt payroll exports,Implemented\n'
    );
    const payroll = await riskBy(w.org.id, 'R-1');
    const [first] = await mitigationsOf(payroll.id);
    await updateMitigation({
      organisationId: w.org.id,
      mitigationId: first.id,
      status: 'verified',
      actor: { ...SYSTEM, actorKind: 'user', actorUserId: w.person.id }
    });

    const again = await imported(
      w.org.id,
      'mitigation',
      [
        'ID,Risk,Description,Status',
        'm-1,R-1,Encrypt payroll and pension exports,In progress',
        'M-1b,R-1,Train the payroll team,',
        'M-1c,R-2,Moved elsewhere,'
      ].join('\n')
    );
    assert.deepEqual(again.preview, { update: 1, create: 2 });
    const now = await mitigationsOf(payroll.id);
    assert.equal(now.length, 2);
    const kept = now.find((m) => m.id === first.id)!;
    assert.equal(kept.description, 'Encrypt payroll and pension exports');
    assert.equal(kept.status, 'verified');
    const trained = now.find((m) => m.externalRef === 'M-1b')!;
    assert.equal(trained.status, 'planned');

    const moved = await imported(
      w.org.id,
      'mitigation',
      'ID,Risk,Description\nM-1,R-2,Encrypt payroll exports\n'
    );
    assert.deepEqual(moved.preview, { refuse: 1 });
    assert.match(moved.rows[0].reason ?? '', /Imported before on RISK-/);
  });

  it('refuses a risk recorded in another entity', async () => {
    const w = await world('import-mitigations-entity');
    await imported(w.org.id, 'risk', RISKS);
    const { preview, rows } = await imported(
      w.org.id,
      'mitigation',
      'ID,Risk,Description\nM-1,R-1,Encrypt payroll exports\n',
      w.other.id
    );
    assert.deepEqual(preview, { refuse: 1 });
    assert.match(
      rows[0].reason ?? '',
      /The risk "R-1" is recorded in Main\. Import its mitigations into that entity/
    );
  });

  it('reminds nobody of a due date until it is confirmed, with its risk or on its own', async () => {
    const w = await world('import-mitigations-reminders');
    await imported(w.org.id, 'risk', RISKS);
    await imported(
      w.org.id,
      'mitigation',
      'ID,Risk,Description,Due date\nM-1,R-1,Encrypt payroll exports,2020-01-31\n'
    );
    assert.equal(
      (await sweepOrganisation(w.org.id)).mitigationRemindersRaised,
      0
    );

    // Confirming the risk confirms what is being done about it.
    const payroll = await riskBy(w.org.id, 'R-1');
    const confirmed = await confirmImportedRecord({
      organisationId: w.org.id,
      type: 'risk',
      id: payroll.id,
      actor: SYSTEM
    });
    assert.ok(confirmed);
    const [encrypt] = await mitigationsOf(payroll.id);
    assert.ok(encrypt.importConfirmedAt);
    // Its own event, so its history says who confirmed it.
    const confirmedEvents = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.subjectId, encrypt.id),
          eq(auditEvents.action, 'mitigation.import_confirmed')
        )
      );
    assert.equal(confirmedEvents.length, 1);
    assert.equal(
      (await sweepOrganisation(w.org.id)).mitigationRemindersRaised,
      1
    );

    // One imported onto a risk already confirmed waits for its own.
    await imported(
      w.org.id,
      'mitigation',
      'ID,Risk,Description,Due date\nM-2,R-1,Train the payroll team,2020-02-28\n'
    );
    const train = (await mitigationsOf(payroll.id)).find(
      (m) => m.externalRef === 'M-2'
    )!;
    assert.equal(train.importConfirmedAt, null);
    assert.equal(
      (await sweepOrganisation(w.org.id)).mitigationRemindersRaised,
      0
    );
    await confirmImportedRecord({
      organisationId: w.org.id,
      type: 'mitigation',
      id: train.id,
      actor: SYSTEM
    });
    assert.equal(
      (await sweepOrganisation(w.org.id)).mitigationRemindersRaised,
      1
    );
    await assert.rejects(
      confirmImportedRecord({
        organisationId: w.org.id,
        type: 'mitigation',
        id: train.id,
        actor: SYSTEM
      }),
      refused(/not waiting to be confirmed/)
    );
  });

  it("refuses to confirm another organisation's mitigation", async () => {
    const a = await world('import-mitigations-tenant-a');
    const b = await world('import-mitigations-tenant-b');
    await imported(b.org.id, 'risk', RISKS);
    await imported(
      b.org.id,
      'mitigation',
      'ID,Risk,Description\nM-1,R-1,Encrypt payroll exports\n'
    );
    const [theirs] = await mitigationsOf((await riskBy(b.org.id, 'R-1')).id);
    await assert.rejects(
      confirmImportedRecord({
        organisationId: a.org.id,
        type: 'mitigation',
        id: theirs.id,
        actor: SYSTEM
      }),
      refused(/not waiting to be confirmed/)
    );
  });

  it('is undone while untouched, and not once one has been worked on here', async () => {
    const w = await world('import-mitigations-undo');
    await imported(w.org.id, 'risk', RISKS);
    const payroll = await riskBy(w.org.id, 'R-1');
    const first = await imported(
      w.org.id,
      'mitigation',
      'ID,Risk,Description\nM-1,R-1,Encrypt payroll exports\n'
    );
    await undoImport({
      organisationId: w.org.id,
      batchId: first.batch.id,
      actor: SYSTEM
    });
    assert.equal((await mitigationsOf(payroll.id)).length, 0);

    const second = await imported(
      w.org.id,
      'mitigation',
      'ID,Risk,Description\nM-1,R-1,Encrypt payroll exports\n'
    );
    const [made] = await mitigationsOf(payroll.id);
    await updateMitigation({
      organisationId: w.org.id,
      mitigationId: made.id,
      status: 'in_progress',
      actor: SYSTEM
    });
    await assert.rejects(
      undoImport({
        organisationId: w.org.id,
        batchId: second.batch.id,
        actor: SYSTEM
      }),
      refused(/changed since it was imported/)
    );
  });

  it('stops a risk import being undone once mitigations sit on its risks', async () => {
    const w = await world('import-mitigations-risk-undo');
    const risksBatch = await imported(w.org.id, 'risk', RISKS);
    await imported(
      w.org.id,
      'mitigation',
      'ID,Risk,Description\nM-1,R-1,Encrypt payroll exports\n'
    );
    await assert.rejects(
      undoImport({
        organisationId: w.org.id,
        batchId: risksBatch.batch.id,
        actor: SYSTEM
      }),
      refused(/now linked to other records/)
    );
    assert.equal(
      (await mitigationsOf((await riskBy(w.org.id, 'R-1')).id)).length,
      1
    );
  });
});
