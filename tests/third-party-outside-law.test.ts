import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { db, sql as pg } from '@/db/client';
import { entities, organisations } from '@/db/schema';
import { setOutsideDataProtectionLaw } from '@/services/entities';
import { sweepOrganisation } from '@/services/sweep';
import {
  createSupplier,
  loadSupplier,
  recordDpa,
  registerHealth
} from '@/services/third-party';

const SYSTEM = {
  actorKind: 'system' as const,
  actorUserId: null,
  actorLabel: 'Third parties outside the law test'
};

after(() => pg.end());

/** An organisation whose one entity is under neither UK nor EU law. */
async function usOnly(label: string) {
  const [org] = await db
    .insert(organisations)
    .values({
      name: `Outside law ${label}`,
      slug: `tpol-${label}-${crypto.randomUUID().slice(0, 8)}`
    })
    .returning();
  const [entity] = await db
    .insert(entities)
    .values({ organisationId: org.id, name: 'Acme Inc', isDefault: true })
    .returning();
  await setOutsideDataProtectionLaw({
    organisationId: org.id,
    entityId: entity.id,
    actor: SYSTEM
  });
  const supplier = await createSupplier({
    organisationId: org.id,
    name: 'Example Payroll',
    actor: SYSTEM
  });
  return { org, supplier };
}

describe('third parties where no entity is under UK or EU law', () => {
  it('asks for no Article 28 contract', async () => {
    const w = await usOnly('none');
    const row = (await loadSupplier(w.supplier.id, w.org.id))!;
    assert.equal(row.privacy, 'out_of_scope');
    assert.deepEqual(row.gaps, ['no_owner']);
    assert.deepEqual(row.hardGaps, []);

    const health = await registerHealth(w.org.id);
    assert.equal(health.lawApplies, false);
    assert.equal(health.uncovered, 0);
  });

  it('raises no task for an agreement that has lapsed', async () => {
    const w = await usOnly('sweep');
    await recordDpa({
      organisationId: w.org.id,
      supplierId: w.supplier.id,
      title: 'Old terms',
      signedAt: new Date('2020-01-01'),
      expiresAt: new Date('2021-01-01'),
      actor: SYSTEM
    });
    assert.equal((await sweepOrganisation(w.org.id)).dpaReviewsRaised, 0);
  });

  it('judges every supplier by Article 28 once any entity is under a law', async () => {
    const w = await usOnly('mixed');
    await db
      .insert(entities)
      .values({ organisationId: w.org.id, name: 'Acme UK Ltd' });
    const row = (await loadSupplier(w.supplier.id, w.org.id))!;
    assert.equal(row.privacy, 'not_met');
    assert.ok(row.gaps.includes('no_dpa'));
    assert.equal((await registerHealth(w.org.id)).lawApplies, true);
  });
});
