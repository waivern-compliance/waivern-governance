import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';

import { db, sql as pg, withOrganisation } from '@/db/client';
import {
  auditEvents,
  cyberScopeAssets,
  cyberScopeEntities,
  cyberScopes,
  entities,
  memberships,
  organisations,
  roleAssignments,
  users
} from '@/db/schema';
import type { OutOfScopeReason } from '@/lib/cyber-essentials/scope';
import {
  isCloudService,
  placementRefusal,
  scopeFindings,
  scopeRefusal,
  type ScopeAsset
} from '@/lib/cyber-essentials/scope-checks';
import { navFor } from '@/lib/nav';
import type { Grant } from '@/lib/rbac';
import {
  createScope,
  cyberEssentialsEnabled,
  loadScope,
  placeAsset,
  scopeRegister,
  setCyberEssentials,
  unplaceAsset,
  updateScope,
  type ScopeInput
} from '@/services/cyber-essentials';
import { erasureBlockers } from '@/services/entity-erasure';
import { createAsset, type AssetDetails } from '@/services/information-assets';

const SYSTEM = {
  actorKind: 'system' as const,
  actorUserId: null,
  actorLabel: 'cyber essentials test'
};

after(() => pg.end());

const refusedBy = (pattern: RegExp) => (e: unknown) => {
  const text = [
    e instanceof Error ? e.message : '',
    (e as { cause?: { message?: string } })?.cause?.message ?? ''
  ].join(' ');
  return pattern.test(text);
};

async function world(label: string, enabled = true) {
  const [org] = await db
    .insert(organisations)
    .values({
      name: `CE ${label}`,
      slug: `ce-${label}-${crypto.randomUUID().slice(0, 8)}`
    })
    .returning();
  const [main] = await db
    .insert(entities)
    .values({ organisationId: org.id, name: 'Main Ltd', isDefault: true })
    .returning();
  const [other] = await db
    .insert(entities)
    .values({ organisationId: org.id, name: 'Other Ltd' })
    .returning();
  if (enabled)
    await setCyberEssentials({
      organisationId: org.id,
      enabled: true,
      actor: SYSTEM
    });
  const asset = (
    entityId: string,
    name: string,
    assetType: string,
    more: Partial<AssetDetails> = {}
  ) =>
    createAsset({
      organisationId: org.id,
      entityId,
      details: {
        name,
        description: null,
        assetType,
        ownerId: null,
        hosting: null,
        hostedBy: null,
        region: null,
        countries: [],
        classification: null,
        retention: null,
        nextReviewAt: null,
        ...more
      },
      actor: SYSTEM
    });
  return { org, main, other, asset };
}

const scopeInput = (more: Partial<ScopeInput> = {}): ScopeInput => ({
  name: 'Head office',
  kind: 'whole_organisation',
  boundary: 'All staff, one office, one internet connection',
  segregation: null,
  exclusions: null,
  entityIds: [],
  ownerId: null,
  nextReviewAt: null,
  ...more
});

const WHOLE = { kind: 'whole_organisation' as const };
const SUBSET = { kind: 'subset' as const };

const fact = (more: Partial<ScopeAsset>): ScopeAsset => ({
  id: crypto.randomUUID(),
  reference: 'IA-1',
  name: 'Asset',
  entityId: 'e',
  assetType: 'system',
  hosting: null,
  details: {},
  retiredAt: null,
  ...more
});

describe('the scope rules', () => {
  it('refuses a scope with no name or entity, and a sub-set that does not say how it is separated', () => {
    const base = {
      name: 'Office',
      kind: 'whole_organisation' as const,
      segregation: null,
      entityIds: ['e']
    };
    assert.equal(scopeRefusal(base), null);
    assert.match(scopeRefusal({ ...base, name: ' ' })!, /name/);
    assert.match(scopeRefusal({ ...base, entityIds: [] })!, /legal entity/);
    assert.match(
      scopeRefusal({ ...base, kind: 'subset' })!,
      /firewall or VLAN/
    );
    assert.equal(
      scopeRefusal({ ...base, kind: 'subset', segregation: 'VLAN 20' }),
      null
    );
  });

  it("refuses to leave out a cloud service, an unexplained other, or a device the organisation owns as someone else's", () => {
    const out = (reason: string, note: string | null = null) => ({
      inScope: false,
      reason: reason as OutOfScopeReason,
      note
    });
    for (const cloud of [
      fact({ assetType: 'saas_application' }),
      fact({ hosting: 'cloud' }),
      fact({ details: { cloudModel: 'iaas' } })
    ])
      assert.match(
        placementRefusal(WHOLE, cloud, out('other', 'We would rather not'))!,
        /Cloud services/
      );
    const laptop = fact({
      assetType: 'device',
      details: { ownership: 'organisation' }
    });
    assert.match(placementRefusal(WHOLE, laptop, out('other'))!, /Explain/);
    assert.match(
      placementRefusal(WHOLE, laptop, out('third_party_owned'))!,
      /wherever they are/
    );
    assert.equal(
      placementRefusal(WHOLE, laptop, out('no_internet_connectivity')),
      null
    );
    assert.equal(
      placementRefusal(
        WHOLE,
        fact({ assetType: 'device', details: { ownership: 'byod' } }),
        out('byod_voice_text_mfa_only')
      ),
      null
    );
    assert.match(
      placementRefusal(WHOLE, fact({ retiredAt: new Date() }), {
        inScope: true,
        reason: null,
        note: null
      })!,
      /retired/
    );
  });

  it('lets a sub-set leave out a cloud service it does not use, and counts an asset on premises as no cloud service', () => {
    const crm = fact({ assetType: 'saas_application' });
    const segregated = {
      inScope: false,
      reason: 'subset_segregated' as OutOfScopeReason,
      note: null
    };
    assert.equal(placementRefusal(SUBSET, crm, segregated), null);
    assert.match(placementRefusal(WHOLE, crm, segregated)!, /Cloud services/);
    assert.match(
      placementRefusal(SUBSET, crm, {
        ...segregated,
        reason: 'no_internet_connectivity' as OutOfScopeReason
      })!,
      /unless the sub-set does not use them/
    );
    const broughtBack = fact({
      assetType: 'server',
      hosting: 'on_premises',
      details: { cloudModel: 'iaas' }
    });
    assert.equal(isCloudService(broughtBack), false);
    assert.equal(isCloudService({ ...broughtBack, hosting: null }), true);
    assert.equal(
      isCloudService({ ...crm, hosting: 'on_premises' }),
      true,
      'a SaaS application is always one'
    );
  });

  it('lists what stands before assessment, each with the rule it comes from', () => {
    const at = new Date('2026-11-19T12:00:00Z');
    const laptop = fact({ assetType: 'device', reference: 'IA-1' });
    const crm = fact({ assetType: 'saas_application', reference: 'IA-2' });
    const nas = fact({ assetType: 'server', reference: 'IA-3' });
    const old = fact({
      assetType: 'server',
      reference: 'IA-4',
      details: { supportedUntil: '2025-01-14' }
    });
    const codes = (kind: 'whole_organisation' | 'subset', placed: string[]) =>
      scopeFindings(
        { kind },
        placed.map((assetId) => ({
          assetId,
          inScope: true,
          reason: null,
          note: null
        })),
        [laptop, crm, nas, old],
        at
      ).map((f) => f.code);

    assert.deepEqual(codes('whole_organisation', []), [
      'SCOPE.END_USER_DEVICES',
      'SCOPE.CLOUD_INCLUDED',
      'SCOPE.BOUNDARY'
    ]);
    // A sub-set need not take in every asset, but still every cloud service.
    assert.deepEqual(codes('subset', [laptop.id]), ['SCOPE.CLOUD_INCLUDED']);
    assert.deepEqual(
      codes('whole_organisation', [laptop.id, crm.id, nas.id, old.id]),
      ['SUM.REMOVE_UNSUPPORTED']
    );
  });
});

describe('the opt-in', () => {
  it('is off until an owner turns it on, audits the change, and hides the menu item while off', async () => {
    const w = await world('opt-in', false);
    assert.equal(await cyberEssentialsEnabled(w.org.id), false);
    await assert.rejects(
      createScope({
        organisationId: w.org.id,
        entityId: w.main.id,
        scope: scopeInput(),
        writable: null,
        actor: SYSTEM
      }),
      /not turned on/
    );
    await setCyberEssentials({
      organisationId: w.org.id,
      enabled: true,
      actor: SYSTEM
    });
    assert.equal(await cyberEssentialsEnabled(w.org.id), true);
    const events = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organisationId, w.org.id),
          eq(auditEvents.action, 'cyber_essentials.enabled')
        )
      );
    assert.equal(events.length, 1);

    const grants = [{ role: 'owner', entityId: null }] as unknown as Grant[];
    const shown = (on: boolean) =>
      navFor(grants, { cyberEssentials: on }).some(
        (i) => i.href === '/app/cyber-essentials'
      );
    assert.equal(shown(false), false);
    assert.equal(shown(true), true);
  });
});

describe('scopes', () => {
  it('records a scope covering its home entity and the others named, with a reference and the edition in force', async () => {
    const w = await world('create');
    const scope = await createScope({
      organisationId: w.org.id,
      entityId: w.main.id,
      scope: scopeInput({ entityIds: [w.other.id] }),
      writable: null,
      actor: SYSTEM
    });
    assert.match(scope.reference, /^CES-\d{4}-0001$/);
    assert.equal(scope.edition, 'v3.3');
    const loaded = (await loadScope(w.org.id, scope.id))!;
    assert.deepEqual(
      loaded.entities.map((e) => e.name),
      ['Main Ltd', 'Other Ltd']
    );
    await assert.rejects(
      createScope({
        organisationId: w.org.id,
        entityId: w.main.id,
        scope: scopeInput({ kind: 'subset' }),
        writable: null,
        actor: SYSTEM
      }),
      /firewall or VLAN/
    );
    assert.deepEqual(
      (await scopeRegister(w.org.id, [w.other.id])).length,
      0,
      'a reader of another entity only does not see it'
    );
    assert.equal((await scopeRegister(w.org.id, null)).length, 1);
  });

  it('places assets of covered entities only, refuses to leave out a cloud service, and audits each placement', async () => {
    const w = await world('place');
    const scope = await createScope({
      organisationId: w.org.id,
      entityId: w.main.id,
      scope: scopeInput(),
      writable: null,
      actor: SYSTEM
    });
    const laptops = await w.asset(w.main.id, 'Laptops', 'device', {
      details: { ownership: 'organisation', quantity: 40 }
    });
    const crm = await w.asset(w.main.id, 'CRM', 'saas_application');
    const elsewhere = await w.asset(w.other.id, 'Their laptops', 'device');
    const place = (assetId: string, inScope: boolean, reason?: string) =>
      placeAsset({
        scopeId: scope.id,
        organisationId: w.org.id,
        assetId,
        inScope,
        reason: reason ?? null,
        note: null,
        actor: SYSTEM
      });

    await place(laptops.id, true);
    await assert.rejects(
      place(crm.id, false, 'no_internet_connectivity'),
      /Cloud services/
    );
    await assert.rejects(place(elsewhere.id, true), /does not cover/);
    await place(crm.id, true);
    // Placing again replaces what was said.
    await place(laptops.id, false, 'no_internet_connectivity');
    await place(laptops.id, true);

    const loaded = (await loadScope(w.org.id, scope.id))!;
    assert.deepEqual(
      loaded.placements.map((p) => p.inScope),
      [true, true]
    );
    assert.deepEqual(
      scopeFindings(
        loaded.scope,
        loaded.placements,
        loaded.candidates,
        new Date()
      ),
      []
    );
    const placed = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.subjectId, scope.id),
          eq(auditEvents.action, 'cyber_scope.asset_placed')
        )
      );
    assert.equal(placed.length, 4);

    await unplaceAsset({
      scopeId: scope.id,
      organisationId: w.org.id,
      assetId: crm.id,
      actor: SYSTEM
    });
    assert.equal((await loadScope(w.org.id, scope.id))!.placements.length, 1);
  });

  it("takes an entity's assets off the lists when the scope stops covering it", async () => {
    const w = await world('uncover');
    const scope = await createScope({
      organisationId: w.org.id,
      entityId: w.main.id,
      scope: scopeInput({ entityIds: [w.other.id] }),
      writable: null,
      actor: SYSTEM
    });
    const theirs = await w.asset(w.other.id, 'Their laptops', 'device');
    const ours = await w.asset(w.main.id, 'Our laptops', 'device');
    for (const a of [theirs, ours])
      await placeAsset({
        scopeId: scope.id,
        organisationId: w.org.id,
        assetId: a.id,
        inScope: true,
        reason: null,
        note: null,
        actor: SYSTEM
      });
    await updateScope({
      id: scope.id,
      organisationId: w.org.id,
      scope: scopeInput({ entityIds: [] }),
      writable: null,
      actor: SYSTEM
    });
    const loaded = (await loadScope(w.org.id, scope.id))!;
    assert.deepEqual(
      loaded.entities.map((e) => e.id),
      [w.main.id]
    );
    assert.deepEqual(
      loaded.placements.map((p) => p.assetId),
      [ours.id]
    );
  });
});

describe('who may shape a scope', () => {
  it('brings in only entities the person can change, and moves the home only within what it covers', async () => {
    const w = await world('writable');
    await assert.rejects(
      createScope({
        organisationId: w.org.id,
        entityId: w.main.id,
        scope: scopeInput({ entityIds: [w.other.id] }),
        writable: [w.main.id],
        actor: SYSTEM
      }),
      /whose records you can change/
    );
    const scope = await createScope({
      organisationId: w.org.id,
      entityId: w.main.id,
      scope: scopeInput(),
      writable: [w.main.id],
      actor: SYSTEM
    });
    await assert.rejects(
      updateScope({
        id: scope.id,
        organisationId: w.org.id,
        scope: scopeInput({ entityIds: [w.other.id] }),
        writable: [w.main.id],
        actor: SYSTEM
      }),
      /whose records you can change/
    );
    await assert.rejects(
      updateScope({
        id: scope.id,
        organisationId: w.org.id,
        scope: scopeInput({ homeEntityId: w.other.id }),
        writable: null,
        actor: SYSTEM
      }),
      /already covers/
    );
    // Someone with access to both brings the other entity in; a person who
    // can change only the home may still save it with the other covered.
    await updateScope({
      id: scope.id,
      organisationId: w.org.id,
      scope: scopeInput({ entityIds: [w.other.id] }),
      writable: null,
      actor: SYSTEM
    });
    await updateScope({
      id: scope.id,
      organisationId: w.org.id,
      scope: scopeInput({ entityIds: [w.other.id], name: 'Renamed' }),
      writable: [w.main.id],
      actor: SYSTEM
    });
    const moved = await updateScope({
      id: scope.id,
      organisationId: w.org.id,
      scope: scopeInput({
        entityIds: [w.main.id, w.other.id],
        homeEntityId: w.other.id
      }),
      writable: null,
      actor: SYSTEM
    });
    assert.equal(moved.entityId, w.other.id);
    assert.deepEqual(
      (await loadScope(w.org.id, scope.id))!.entities.map((e) => e.name),
      ['Main Ltd', 'Other Ltd']
    );
  });

  it('refuses an owner who cannot open the home entity', async () => {
    const w = await world('owner');
    const [outsider] = await db
      .insert(users)
      .values({ email: `other-${crypto.randomUUID().slice(0, 8)}@example.com` })
      .returning();
    const [membership] = await db
      .insert(memberships)
      .values({ organisationId: w.org.id, userId: outsider.id })
      .returning();
    await db.insert(roleAssignments).values({
      membershipId: membership.id,
      role: 'privacy_analyst',
      scope: 'entity',
      entityId: w.other.id
    });
    await assert.rejects(
      createScope({
        organisationId: w.org.id,
        entityId: w.main.id,
        scope: scopeInput({ ownerId: outsider.id }),
        writable: null,
        actor: SYSTEM
      }),
      /must be able to open records/
    );
    const scope = await createScope({
      organisationId: w.org.id,
      entityId: w.other.id,
      scope: scopeInput({ ownerId: outsider.id }),
      writable: null,
      actor: SYSTEM
    });
    assert.equal(scope.ownerId, outsider.id);
  });

  it('keeps its home entity from being deleted while it covers others', async () => {
    const w = await world('erasure');
    await createScope({
      organisationId: w.org.id,
      entityId: w.other.id,
      scope: scopeInput({ entityIds: [w.main.id] }),
      writable: null,
      actor: SYSTEM
    });
    assert.ok(
      (await erasureBlockers(w.org.id, w.other.id)).some((r) =>
        /Move each scope's home/.test(r)
      )
    );
  });
});

describe('the database', () => {
  it("keeps each organisation's scopes to itself", async () => {
    const a = await world('rls-a');
    const b = await world('rls-b');
    const scope = await createScope({
      organisationId: a.org.id,
      entityId: a.main.id,
      scope: scopeInput(),
      writable: null,
      actor: SYSTEM
    });
    const seen = await withOrganisation(b.org.id, () =>
      db.select().from(cyberScopes).where(eq(cyberScopes.id, scope.id))
    );
    assert.equal(seen.length, 0);
    const theirs = await b.asset(b.main.id, 'Their laptops', 'device');
    // Even claiming the asset's organisation, a scope cannot cover or place
    // another organisation's records.
    await assert.rejects(
      withOrganisation(b.org.id, () =>
        db.insert(cyberScopeEntities).values({
          organisationId: b.org.id,
          scopeId: scope.id,
          entityId: b.main.id
        })
      ),
      refusedBy(/its own organisation/)
    );
    await assert.rejects(
      withOrganisation(a.org.id, () =>
        db.insert(cyberScopeAssets).values({
          organisationId: a.org.id,
          scopeId: scope.id,
          assetId: theirs.id,
          inScope: true
        })
      ),
      refusedBy(/its own organisation/)
    );
  });

  it('refuses a sub-set with no separation, and an asset left out with no reason', async () => {
    const w = await world('constraints');
    const scope = await createScope({
      organisationId: w.org.id,
      entityId: w.main.id,
      scope: scopeInput(),
      writable: null,
      actor: SYSTEM
    });
    await assert.rejects(
      withOrganisation(w.org.id, () =>
        db
          .update(cyberScopes)
          .set({ kind: 'subset' })
          .where(eq(cyberScopes.id, scope.id))
      ),
      refusedBy(/cyber_scope_kind/)
    );
    const laptops = await w.asset(w.main.id, 'Laptops', 'device');
    await assert.rejects(
      withOrganisation(w.org.id, () =>
        db.insert(cyberScopeAssets).values({
          organisationId: w.org.id,
          scopeId: scope.id,
          assetId: laptops.id,
          inScope: false
        })
      ),
      refusedBy(/cyber_scope_asset_reason/)
    );
    const elsewhere = await w.asset(w.other.id, 'Their laptops', 'device');
    await assert.rejects(
      withOrganisation(w.org.id, () =>
        db.insert(cyberScopeAssets).values({
          organisationId: w.org.id,
          scopeId: scope.id,
          assetId: elsewhere.id,
          inScope: true
        })
      ),
      refusedBy(/entities it covers/)
    );
  });
});
