import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';

import { db, sql as pg } from '@/db/client';
import { auditEvents, entities, organisations } from '@/db/schema';
import { verifyAuditChain } from '@/lib/audit';
import { cleanRetirement } from '@/lib/retirement';
import {
  setDataProtectionLaw,
  setOutsideDataProtectionLaw
} from '@/services/entities';
import {
  createActivity,
  registerHealth,
  restoreActivity,
  retireActivity,
  updateActivity
} from '@/services/ropa';
import { setSupplierTier } from '@/services/supplier-tier';
import {
  createSupplier,
  recordDpa,
  restoreSupplier,
  retireSupplier,
  registerHealth as supplierHealth,
  updateSupplier
} from '@/services/third-party';

const SYSTEM = {
  actorKind: 'system' as const,
  actorUserId: null,
  actorLabel: 'Retirement test'
};

after(() => pg.end());

async function world(label: string) {
  const [org] = await db
    .insert(organisations)
    .values({
      name: `Retirement ${label}`,
      slug: `ret-${label}-${crypto.randomUUID().slice(0, 8)}`
    })
    .returning();
  const [entity] = await db
    .insert(entities)
    .values({ organisationId: org.id, name: 'Acme Ltd', isDefault: true })
    .returning();
  const activity = await createActivity({
    organisationId: org.id,
    entityId: entity.id,
    name: 'Payroll',
    actor: SYSTEM
  });
  return { org, entity, activity };
}

const retire = (
  w: Awaited<ReturnType<typeof world>>,
  reason = 'no_longer_used',
  note = ''
) =>
  retireActivity({
    activityId: w.activity.id,
    organisationId: w.org.id,
    reason,
    note,
    actor: SYSTEM
  });

const actionsOn = async (organisationId: string, subjectId: string) =>
  (
    await db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organisationId, organisationId),
          eq(auditEvents.subjectId, subjectId)
        )
      )
      .orderBy(auditEvents.seq)
  ).map((e) => e.action);

describe('the reason for retiring', () => {
  it('refuses a record retired without a reason', () => {
    assert.throws(
      () => cleanRetirement({ reason: '', note: '' }),
      /Say why it is being retired/
    );
  });

  it('refuses a merge that does not say where the record went', () => {
    assert.throws(
      () => cleanRetirement({ reason: 'merged', note: ' ' }),
      /which record it was merged into/
    );
  });
});

describe('retiring a processing activity', () => {
  it('takes it off the register and keeps it, with its history', async () => {
    const w = await world('off');
    await retire(w);
    const health = await registerHealth(w.org.id, null);
    assert.equal(health.total, 0);
    assert.deepEqual(
      health.retired.map((r) => r.activity.id),
      [w.activity.id]
    );
    assert.deepEqual(await actionsOn(w.org.id, w.activity.id), [
      'processing_activity.created',
      'processing_activity.retired'
    ]);
  });

  it('refuses edits until it is restored', async () => {
    const w = await world('edit');
    await retire(w);
    await assert.rejects(
      updateActivity({
        activityId: w.activity.id,
        organisationId: w.org.id,
        changes: { name: 'Payroll and pensions' },
        actor: SYSTEM
      }),
      /Restore it to change it/
    );
  });

  it('puts it back on the register when restored, and keeps both events', async () => {
    const w = await world('restore');
    await retire(w, 'recorded_in_error');
    await restoreActivity({
      activityId: w.activity.id,
      organisationId: w.org.id,
      actor: SYSTEM
    });
    const health = await registerHealth(w.org.id, null);
    assert.equal(health.total, 1);
    assert.equal(health.retired.length, 0);
    assert.deepEqual((await actionsOn(w.org.id, w.activity.id)).slice(1), [
      'processing_activity.retired',
      'processing_activity.restored'
    ]);
    assert.equal((await verifyAuditChain(w.org.id)).ok, true);
  });
});

describe('the register filtered by law', () => {
  it('lists only the retired records under that law', async () => {
    const w = await world('law-filter');
    await setDataProtectionLaw({
      organisationId: w.org.id,
      entityId: w.entity.id,
      law: 'uk_eu',
      actor: SYSTEM
    });
    await updateActivity({
      activityId: w.activity.id,
      organisationId: w.org.id,
      changes: { laws: 'uk' },
      actor: SYSTEM
    });
    await retire(w);
    assert.equal(
      (await registerHealth(w.org.id, null, 'eu')).retired.length,
      0
    );
    assert.equal(
      (await registerHealth(w.org.id, null, 'uk')).retired.length,
      1
    );
  });
});

describe('an entity whose processing records are all retired', () => {
  it('may be taken outside data protection law', async () => {
    const w = await world('outside');
    await retire(w);
    const entity = await setOutsideDataProtectionLaw({
      organisationId: w.org.id,
      entityId: w.entity.id,
      actor: SYSTEM
    });
    assert.equal(entity.dataProtectionLawApplies, false);
  });

  it('is still held under the law by a record on the register', async () => {
    const w = await world('held');
    await createActivity({
      organisationId: w.org.id,
      entityId: w.entity.id,
      name: 'Recruitment',
      actor: SYSTEM
    });
    await retire(w);
    await assert.rejects(
      setOutsideDataProtectionLaw({
        organisationId: w.org.id,
        entityId: w.entity.id,
        actor: SYSTEM
      }),
      /holds records kept under data protection law/
    );
  });

  it('refuses to restore a record once the entity is outside the law', async () => {
    const w = await world('no-restore');
    await retire(w);
    await setOutsideDataProtectionLaw({
      organisationId: w.org.id,
      entityId: w.entity.id,
      actor: SYSTEM
    });
    await assert.rejects(
      restoreActivity({
        activityId: w.activity.id,
        organisationId: w.org.id,
        actor: SYSTEM
      }),
      /subject to neither UK nor EU data protection law/
    );
  });

  it('may be narrowed to one law past a retired record under the other', async () => {
    const w = await world('narrow');
    await setDataProtectionLaw({
      organisationId: w.org.id,
      entityId: w.entity.id,
      law: 'uk_eu',
      actor: SYSTEM
    });
    await updateActivity({
      activityId: w.activity.id,
      organisationId: w.org.id,
      changes: { laws: 'uk' },
      actor: SYSTEM
    });
    await retire(w);
    await setDataProtectionLaw({
      organisationId: w.org.id,
      entityId: w.entity.id,
      law: 'eu',
      actor: SYSTEM
    });
    await assert.rejects(
      restoreActivity({
        activityId: w.activity.id,
        organisationId: w.org.id,
        actor: SYSTEM
      }),
      /It stays retired/
    );
  });
});

describe('retiring a third party', () => {
  it('takes it off the register, refuses edits, and restores', async () => {
    const w = await world('supplier');
    const supplier = await createSupplier({
      organisationId: w.org.id,
      name: 'Acme Payroll Services',
      actor: SYSTEM
    });
    await retireSupplier({
      supplierId: supplier.id,
      organisationId: w.org.id,
      reason: 'merged',
      note: 'Now Acme Payroll Group',
      actor: SYSTEM
    });
    const health = await supplierHealth(w.org.id);
    assert.equal(health.total, 0);
    assert.equal(
      health.retired[0].supplier.retiredNote,
      'Now Acme Payroll Group'
    );
    await assert.rejects(
      updateSupplier({
        supplierId: supplier.id,
        organisationId: w.org.id,
        changes: { description: 'Payroll' },
        actor: SYSTEM
      }),
      /Restore it to change it/
    );
    await restoreSupplier({
      supplierId: supplier.id,
      organisationId: w.org.id,
      actor: SYSTEM
    });
    assert.equal((await supplierHealth(w.org.id)).total, 1);
  });

  it('keeps what hangs off it as it was: no new agreement, no tier', async () => {
    const w = await world('hangs');
    const supplier = await createSupplier({
      organisationId: w.org.id,
      name: 'Acme Mail',
      actor: SYSTEM
    });
    await retireSupplier({
      supplierId: supplier.id,
      organisationId: w.org.id,
      reason: 'no_longer_used',
      note: '',
      actor: SYSTEM
    });
    await assert.rejects(
      recordDpa({
        organisationId: w.org.id,
        supplierId: supplier.id,
        title: 'DPA 2027',
        actor: SYSTEM
      }),
      /Restore it to change it/
    );
    await assert.rejects(
      setSupplierTier({
        organisationId: w.org.id,
        supplierId: supplier.id,
        tier: 'low',
        reason: 'Small',
        actor: SYSTEM
      }),
      /Restore it to change it/
    );
  });

  it('refuses to add a retired third party again, and says to restore it', async () => {
    const w = await world('again');
    const supplier = await createSupplier({
      organisationId: w.org.id,
      name: 'Acme Analytics',
      actor: SYSTEM
    });
    await retireSupplier({
      supplierId: supplier.id,
      organisationId: w.org.id,
      reason: 'no_longer_used',
      note: '',
      actor: SYSTEM
    });
    await assert.rejects(
      createSupplier({
        organisationId: w.org.id,
        name: 'acme analytics',
        actor: SYSTEM
      }),
      /retired\. Restore it/
    );
  });
});
