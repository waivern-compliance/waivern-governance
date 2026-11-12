import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';

import { db, sql as pg } from '@/db/client';
import { auditEvents, entities, organisations } from '@/db/schema';
import {
  cleanEprivacyScope,
  effectiveEprivacy,
  entityEprivacy,
  EprivacyRefused,
  ieEprivacySuggested
} from '@/lib/ie-eprivacy/scope';
import { navFor } from '@/lib/nav';
import type { Grant } from '@/lib/rbac';
import {
  anyEntityUnderEprivacy,
  EntityRefused,
  setDataProtectionLaw,
  setIeEprivacy
} from '@/services/entities';
import { guidanceFor } from '@/services/guidance';
import {
  createMarketingActivity,
  MarketingRefused,
  updateMarketingActivity
} from '@/services/marketing';
import {
  createProperty,
  InventoryRefused,
  updateProperty
} from '@/services/storage-inventory';

const SYSTEM = {
  actorKind: 'system' as const,
  actorUserId: null,
  actorLabel: 'Irish ePrivacy test'
};

after(() => pg.end());

async function world(label: string) {
  const [org] = await db
    .insert(organisations)
    .values({
      name: `IE ePrivacy ${label}`,
      slug: `iee-${label}-${crypto.randomUUID().slice(0, 8)}`
    })
    .returning();
  const [entity] = await db
    .insert(entities)
    .values({ organisationId: org.id, name: 'Group Ltd', isDefault: true })
    .returning();
  return { org, entity };
}

const lawOf = async (
  organisationId: string,
  entityId: string,
  law: 'uk' | 'eu' | 'uk_eu'
) => setDataProtectionLaw({ organisationId, entityId, law, actor: SYSTEM });

const property = (organisationId: string, entityId: string, scope?: string) =>
  createProperty({
    organisationId,
    entityId,
    name: 'Shop',
    url: 'https://shop.example.ie',
    eprivacyScope: scope,
    actor: SYSTEM
  });

describe('which ePrivacy law applies', () => {
  const e = (
    dataProtectionLaw: 'uk' | 'eu' | 'uk_eu',
    ieEprivacy: boolean | null
  ) => ({ name: 'Group Ltd', dataProtectionLaw, ieEprivacy });

  it('follows UK law for PECR, and the declared answer under EU law for Ireland', () => {
    assert.equal(entityEprivacy(e('uk', null)), 'uk');
    assert.equal(entityEprivacy(e('uk_eu', true)), 'uk_ie');
    assert.equal(entityEprivacy(e('eu', true)), 'ie');
    // Unanswered counts as no, and a stray answer without EU law counts for nothing.
    assert.equal(entityEprivacy(e('eu', null)), null);
    assert.equal(entityEprivacy(e('uk', true)), 'uk');
  });

  it('judges a record within its entity, and refuses one outside it', () => {
    assert.equal(effectiveEprivacy('uk_ie', 'ie'), 'ie');
    assert.equal(effectiveEprivacy('uk', 'uk_ie'), 'uk');
    assert.equal(effectiveEprivacy('uk', 'ie'), null);
    assert.equal(cleanEprivacyScope(e('uk_eu', true), null), 'uk_ie');
    assert.equal(cleanEprivacyScope(e('uk_eu', true), 'ie'), 'ie');
    assert.throws(
      () => cleanEprivacyScope(e('uk', null), 'ie'),
      EprivacyRefused
    );
    assert.throws(() => cleanEprivacyScope(e('eu', false), null), /Neither/);
    assert.throws(
      () => cleanEprivacyScope(e('uk', null), 'fr'),
      EprivacyRefused
    );
  });

  it('suggests the question from an Irish establishment or the DPC, only while unanswered', () => {
    const base = {
      dataProtectionLaw: 'eu' as const,
      ieEprivacy: null,
      euEstablishments: [] as string[],
      euLeadAuthority: null as string | null
    };
    assert.equal(ieEprivacySuggested(base), false);
    assert.equal(
      ieEprivacySuggested({ ...base, euEstablishments: ['IE'] }),
      true
    );
    assert.equal(
      ieEprivacySuggested({ ...base, euLeadAuthority: 'ie-dpc' }),
      true
    );
    assert.equal(
      ieEprivacySuggested({
        ...base,
        euEstablishments: ['IE'],
        ieEprivacy: false
      }),
      false
    );
    assert.equal(
      ieEprivacySuggested({
        ...base,
        dataProtectionLaw: 'uk',
        euEstablishments: ['IE']
      }),
      false
    );
  });
});

describe('the entity flag', () => {
  it('is refused without EU law, and recorded with its audit event where EU law applies', async () => {
    const w = await world('flag');
    await assert.rejects(
      setIeEprivacy({
        organisationId: w.org.id,
        entityId: w.entity.id,
        applies: true,
        actor: SYSTEM
      }),
      EntityRefused
    );
    await lawOf(w.org.id, w.entity.id, 'uk_eu');
    const on = await setIeEprivacy({
      organisationId: w.org.id,
      entityId: w.entity.id,
      applies: true,
      actor: SYSTEM
    });
    assert.equal(on.ieEprivacy, true);
    const events = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.subjectId, w.entity.id),
          eq(auditEvents.action, 'entity.ie_eprivacy_changed')
        )
      );
    assert.equal(events.length, 1);
    assert.deepEqual(events[0].after, { ieEprivacy: true });
  });

  it('records a no, and refuses narrowing to UK law while it is on', async () => {
    const w = await world('narrow');
    await lawOf(w.org.id, w.entity.id, 'uk_eu');
    const no = await setIeEprivacy({
      organisationId: w.org.id,
      entityId: w.entity.id,
      applies: false,
      actor: SYSTEM
    });
    assert.equal(no.ieEprivacy, false);
    await setIeEprivacy({
      organisationId: w.org.id,
      entityId: w.entity.id,
      applies: true,
      actor: SYSTEM
    });
    await assert.rejects(
      lawOf(w.org.id, w.entity.id, 'uk'),
      /Irish ePrivacy Regulations/
    );
    // Narrowing to EU law keeps it.
    const eu = await lawOf(w.org.id, w.entity.id, 'eu');
    assert.equal(eu.ieEprivacy, true);
  });

  it('cannot be turned off while a record is under the Irish Regulations alone', async () => {
    const w = await world('off');
    await lawOf(w.org.id, w.entity.id, 'uk_eu');
    await setIeEprivacy({
      organisationId: w.org.id,
      entityId: w.entity.id,
      applies: true,
      actor: SYSTEM
    });
    const site = await property(w.org.id, w.entity.id, 'ie');
    await assert.rejects(
      setIeEprivacy({
        organisationId: w.org.id,
        entityId: w.entity.id,
        applies: false,
        actor: SYSTEM
      }),
      new RegExp(site.reference)
    );
    await updateProperty({
      propertyId: site.id,
      organisationId: w.org.id,
      changes: { eprivacyScope: 'uk_ie' },
      actor: SYSTEM
    });
    const off = await setIeEprivacy({
      organisationId: w.org.id,
      entityId: w.entity.id,
      applies: false,
      actor: SYSTEM
    });
    assert.equal(off.ieEprivacy, false);
  });
});

describe('scope on websites, apps and marketing', () => {
  it("takes the entity's laws, the one chosen, and refuses one outside them", async () => {
    const w = await world('scope');
    assert.equal((await property(w.org.id, w.entity.id)).eprivacyScope, 'uk');
    await assert.rejects(
      property(w.org.id, w.entity.id, 'ie'),
      InventoryRefused
    );

    await lawOf(w.org.id, w.entity.id, 'uk_eu');
    await setIeEprivacy({
      organisationId: w.org.id,
      entityId: w.entity.id,
      applies: true,
      actor: SYSTEM
    });
    assert.equal(
      (await property(w.org.id, w.entity.id)).eprivacyScope,
      'uk_ie'
    );
    assert.equal(
      (await property(w.org.id, w.entity.id, 'ie')).eprivacyScope,
      'ie'
    );

    const campaign = await createMarketingActivity({
      organisationId: w.org.id,
      entityId: w.entity.id,
      name: 'Newsletter',
      channel: 'email',
      eprivacyScope: 'ie',
      actor: SYSTEM
    });
    assert.equal(campaign.eprivacyScope, 'ie');
    const moved = await updateMarketingActivity({
      activityId: campaign.id,
      organisationId: w.org.id,
      changes: { eprivacyScope: 'uk_ie' },
      actor: SYSTEM
    });
    assert.equal(moved.eprivacyScope, 'uk_ie');
    await assert.rejects(
      updateMarketingActivity({
        activityId: campaign.id,
        organisationId: w.org.id,
        changes: { eprivacyScope: 'fr' },
        actor: SYSTEM
      }),
      MarketingRefused
    );
  });

  it('refuses a record where neither law applies to the entity', async () => {
    const w = await world('neither');
    await lawOf(w.org.id, w.entity.id, 'eu');
    await assert.rejects(property(w.org.id, w.entity.id), /Neither UK PECR/);
    await assert.rejects(
      createMarketingActivity({
        organisationId: w.org.id,
        entityId: w.entity.id,
        name: 'Calls',
        channel: 'live_call',
        actor: SYSTEM
      }),
      MarketingRefused
    );
  });
});

describe('hiding the registers', () => {
  it('offers them only where some entity is under an ePrivacy law', async () => {
    const w = await world('hide');
    assert.equal(await anyEntityUnderEprivacy(w.org.id), true);
    await lawOf(w.org.id, w.entity.id, 'eu');
    assert.equal(await anyEntityUnderEprivacy(w.org.id), false);
    const steps = async () =>
      (
        await guidanceFor({ organisationId: w.org.id, chosen: 'maintain' })
      ).steps.map((s) => s.id);
    assert.ok(!(await steps()).includes('cookies'));
    assert.ok(!(await steps()).includes('marketing'));

    await setIeEprivacy({
      organisationId: w.org.id,
      entityId: w.entity.id,
      applies: true,
      actor: SYSTEM
    });
    assert.equal(await anyEntityUnderEprivacy(w.org.id), true);
    assert.ok((await steps()).includes('cookies'));

    const grants = [{ role: 'owner', entityId: null }] as unknown as Grant[];
    const hrefs = (eprivacy: boolean) =>
      navFor(grants, { eprivacy }).map((i) => i.href);
    assert.ok(hrefs(true).includes('/app/cookies'));
    assert.ok(!hrefs(false).includes('/app/cookies'));
    assert.ok(!hrefs(false).includes('/app/marketing'));
  });
});
