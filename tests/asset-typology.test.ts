import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { and, eq, like } from 'drizzle-orm';

import { db, sql as pg, withOrganisation } from '@/db/client';
import {
  assetTypes,
  auditEvents,
  entities,
  informationAssets,
  memberships,
  organisations,
  roleAssignments,
  tasks,
  users
} from '@/db/schema';
import {
  assetTypeKeyFrom,
  BUILT_IN_ASSET_TYPES,
  cleanDetails,
  describeDetails,
  offeredTypes,
  typology
} from '@/lib/assets/types';
import { can } from '@/lib/rbac';
import { reminderKey } from '@/lib/renewals';
import {
  assetTypology,
  createAssetType,
  deleteAssetType,
  ownAssetTypes,
  setAssetTypeRetired,
  updateAssetType
} from '@/services/asset-types';
import { createContract } from '@/services/contracts';
import { exportAssets } from '@/services/exports';
import {
  assetsFor,
  assetsNeedingRenewal,
  createAsset,
  linkAsset,
  loadAsset,
  retireAsset,
  updateAsset,
  type AssetDetails
} from '@/services/information-assets';
import { upcomingRenewals } from '@/services/renewals';
import { sweepOrganisation } from '@/services/sweep';
import { createSupplier } from '@/services/third-party';

const SYSTEM = {
  actorKind: 'system' as const,
  actorUserId: null,
  actorLabel: 'typology test'
};
const DAY = 86_400_000;

after(() => pg.end());

async function world(label: string) {
  const [org] = await db
    .insert(organisations)
    .values({
      name: `Typology ${label}`,
      slug: `typology-${label}-${crypto.randomUUID().slice(0, 8)}`
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
  const member = async (entityId?: string) => {
    const [user] = await db
      .insert(users)
      .values({ email: `t-${crypto.randomUUID().slice(0, 8)}@example.com` })
      .returning();
    const [membership] = await db
      .insert(memberships)
      .values({ organisationId: org.id, userId: user.id })
      .returning();
    await db.insert(roleAssignments).values({
      membershipId: membership.id,
      role: 'privacy_admin',
      ...(entityId ? { scope: 'entity', entityId } : { scope: 'organisation' })
    });
    return user;
  };
  const admin = await member();
  const supplier = await createSupplier({
    organisationId: org.id,
    name: `Registrar ${label}`,
    actor: SYSTEM
  });
  return { org, main, other, admin, member, supplier };
}

type World = Awaited<ReturnType<typeof world>>;

const asset = (over: Partial<AssetDetails> = {}): AssetDetails => ({
  name: 'example.org',
  description: null,
  assetType: 'domain',
  ownerId: null,
  hosting: null,
  hostedBy: null,
  region: null,
  countries: [],
  classification: null,
  retention: null,
  nextReviewAt: null,
  ...over
});

const actorFor = (user: { id: string; email: string }) => ({
  actorKind: 'user' as const,
  actorUserId: user.id,
  actorLabel: user.email
});

/** The database's own refusal, which arrives as the cause of a failed query. */
const refusedBy = (pattern: RegExp) => (error: Error) =>
  pattern.test(
    `${error.message} ${(error.cause as Error | undefined)?.message ?? ''}`
  );

const remindersFor = (w: World, assetId: string) =>
  db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.organisationId, w.org.id),
        like(tasks.idempotencyKey, `asset-%:${assetId}:%`)
      )
    );

describe('the typology', () => {
  it("keeps the register's keys and adds domains, certificates and licences that expire", () => {
    const keys = BUILT_IN_ASSET_TYPES.map((t) => t.key);
    for (const k of [
      'system',
      'database',
      'file_share',
      'saas_application',
      'paper_archive',
      'device',
      'other'
    ])
      assert.ok(keys.includes(k), k);
    for (const k of ['domain', 'certificate', 'software_licence'])
      assert.equal(
        BUILT_IN_ASSET_TYPES.find((t) => t.key === k)?.hasExpiry,
        true,
        k
      );
    for (const t of BUILT_IN_ASSET_TYPES) assert.ok(t.definition.trim());
  });

  it('makes a key from a name', () => {
    assert.equal(assetTypeKeyFrom('Mobile app'), 'mobile_app');
    assert.equal(assetTypeKeyFrom('  Café  records! '), 'cafe_records');
    assert.equal(assetTypeKeyFrom('3D printer'), 't_3d_printer');
    assert.equal(assetTypeKeyFrom('!!!'), '');
  });

  it("keeps only a type's own fields, and refuses a count that is not whole", () => {
    const licence = BUILT_IN_ASSET_TYPES.find(
      (t) => t.key === 'software_licence'
    )!;
    const cert = BUILT_IN_ASSET_TYPES.find((t) => t.key === 'certificate')!;
    assert.deepEqual(
      cleanDetails(licence, { seats: 25, registrar: 'Not a licence field' }),
      { ok: true, details: { seats: 25 } }
    );
    assert.equal(cleanDetails(licence, { seats: 2.5 }).ok, false);
    const names = cleanDetails(cert, {
      issuer: ' A CA ',
      names: ['example.org', 'example.org', '', 'www.example.org']
    });
    assert.deepEqual(names, {
      ok: true,
      details: { issuer: 'A CA', names: ['example.org', 'www.example.org'] }
    });
    assert.deepEqual(
      describeDetails(cert, { issuer: 'A CA', names: ['a', 'b'] }),
      [
        { label: 'Issuer', value: 'A CA' },
        { label: 'Names covered', value: 'a, b' }
      ]
    );
  });

  it('offers a retired type only to the asset that already has it', () => {
    const types = typology([
      {
        key: 'ledger',
        label: 'Ledger',
        definition: 'Books.',
        hasExpiry: false,
        retiredAt: new Date()
      }
    ]);
    assert.ok(!offeredTypes(types).some((t) => t.key === 'ledger'));
    assert.ok(offeredTypes(types, 'ledger').some((t) => t.key === 'ledger'));
  });

  it('keys asset reminders apart from contract reminders', () => {
    const dates = {
      id: 'x',
      endsAt: new Date(Date.now() + 10 * DAY),
      noticeDays: 0,
      autoRenews: false,
      endedAt: null
    };
    assert.match(reminderKey('asset', dates) ?? '', /^asset-notice:x:/);
    assert.match(reminderKey('contract', dates) ?? '', /^contract-notice:x:/);
  });

  it('lets owners and privacy administrators manage types, and nobody else', () => {
    const grant = (role: 'owner' | 'privacy_admin' | 'privacy_analyst') => [
      { role, scope: 'organisation' as const }
    ];
    assert.equal(can(grant('owner'), 'asset_type.manage'), true);
    assert.equal(can(grant('privacy_admin'), 'asset_type.manage'), true);
    assert.equal(can(grant('privacy_analyst'), 'asset_type.manage'), false);
  });
});

describe("the organisation's own types", () => {
  it('adds a type with its definition, and audits it', async () => {
    const w = await world('add');
    const t = await createAssetType({
      organisationId: w.org.id,
      type: {
        label: 'Mobile app',
        definition: 'An app we publish in the stores.',
        hasExpiry: false
      },
      actor: SYSTEM
    });
    assert.equal(t.key, 'mobile_app');
    const types = await assetTypology(w.org.id);
    assert.equal(types.at(-1)?.label, 'Mobile app');
    const [event] = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organisationId, w.org.id),
          eq(auditEvents.action, 'asset_type.created')
        )
      );
    assert.equal((event.after as { key: string }).key, 'mobile_app');
  });

  it('refuses a type with no definition, or a name already taken', async () => {
    const w = await world('refuse');
    const add = (label: string, definition = 'Defined.') =>
      createAssetType({
        organisationId: w.org.id,
        type: { label, definition, hasExpiry: false },
        actor: SYSTEM
      });
    await assert.rejects(add('Ledger', '  '), /Define the type/);
    await assert.rejects(add('domain'), /already a type called/);
    await add('Ledger');
    await assert.rejects(add('ledger'), /already a type called/);
    await assert.rejects(add('Ledger!'), /too like/);
  });

  it('gives a new type a fresh key when a renamed type still holds the one its name makes', async () => {
    const w = await world('rekey');
    const add = (label: string) =>
      createAssetType({
        organisationId: w.org.id,
        type: { label, definition: 'Defined.', hasExpiry: false },
        actor: SYSTEM
      });
    const first = await add('Mobile app');
    await updateAssetType({
      organisationId: w.org.id,
      key: first.key,
      type: { label: 'Web app', definition: 'Defined.', hasExpiry: false },
      actor: SYSTEM
    });
    const second = await add('Mobile app');
    assert.equal(first.key, 'mobile_app');
    assert.equal(second.key, 'mobile_app_2');
  });

  it('gives assets the type, refuses a retired type to new ones, and lets existing ones keep it', async () => {
    const w = await world('retire');
    const t = await createAssetType({
      organisationId: w.org.id,
      type: { label: 'Ledger', definition: 'Books.', hasExpiry: false },
      actor: SYSTEM
    });
    const a = await createAsset({
      organisationId: w.org.id,
      entityId: w.main.id,
      details: asset({ name: 'Cash book', assetType: t.key }),
      actor: SYSTEM
    });
    await setAssetTypeRetired({
      organisationId: w.org.id,
      key: t.key,
      retired: true,
      actor: SYSTEM
    });
    await assert.rejects(
      createAsset({
        organisationId: w.org.id,
        entityId: w.main.id,
        details: asset({ name: 'Another', assetType: t.key }),
        actor: SYSTEM
      }),
      /has been retired/
    );
    const kept = await updateAsset({
      id: a.id,
      organisationId: w.org.id,
      details: asset({ name: 'Cash book, renamed', assetType: t.key }),
      actor: SYSTEM
    });
    assert.equal(kept.assetType, t.key);
    assert.equal((await ownAssetTypes(w.org.id))[0].assets, 1);
  });

  it('will not delete a type while an asset has it, in the service or the database', async () => {
    const w = await world('delete');
    const t = await createAssetType({
      organisationId: w.org.id,
      type: { label: 'Ledger', definition: 'Books.', hasExpiry: false },
      actor: SYSTEM
    });
    const a = await createAsset({
      organisationId: w.org.id,
      entityId: w.main.id,
      details: asset({ name: 'Cash book', assetType: t.key }),
      actor: SYSTEM
    });
    await retireAsset({
      id: a.id,
      organisationId: w.org.id,
      reason: 'Closed',
      actor: SYSTEM
    });
    await assert.rejects(
      deleteAssetType({ organisationId: w.org.id, key: t.key, actor: SYSTEM }),
      /Retire the type instead/
    );
    await assert.rejects(
      withOrganisation(w.org.id, () =>
        db.delete(assetTypes).where(eq(assetTypes.id, t.id))
      ),
      refusedBy(/cannot be deleted while assets have it/)
    );

    const unused = await createAssetType({
      organisationId: w.org.id,
      type: { label: 'Tally stick', definition: 'Old.', hasExpiry: false },
      actor: SYSTEM
    });
    await deleteAssetType({
      organisationId: w.org.id,
      key: unused.key,
      actor: SYSTEM
    });
    assert.deepEqual(
      (await ownAssetTypes(w.org.id)).map((x) => x.key),
      [t.key]
    );
  });

  it('will not stop a type expiring while its assets carry dates', async () => {
    const w = await world('expiry');
    const t = await createAssetType({
      organisationId: w.org.id,
      type: { label: 'Permit', definition: 'A permit.', hasExpiry: true },
      actor: SYSTEM
    });
    await createAsset({
      organisationId: w.org.id,
      entityId: w.main.id,
      details: asset({
        name: 'Waste permit',
        assetType: t.key,
        expiresAt: new Date(Date.now() + 200 * DAY)
      }),
      actor: SYSTEM
    });
    await assert.rejects(
      updateAssetType({
        organisationId: w.org.id,
        key: t.key,
        type: { label: 'Permit', definition: 'A permit.', hasExpiry: false },
        actor: SYSTEM
      }),
      /Clear it first/
    );
  });

  it('refuses a key that is built in, or a type that is not, in the database', async () => {
    const w = await world('guards');
    await assert.rejects(
      withOrganisation(w.org.id, () =>
        db.insert(assetTypes).values({
          organisationId: w.org.id,
          key: 'domain',
          label: 'Mine',
          definition: 'x'
        })
      ),
      refusedBy(/asset_type_key_format/)
    );
    await assert.rejects(
      withOrganisation(w.org.id, () =>
        db.insert(informationAssets).values({
          organisationId: w.org.id,
          entityId: w.main.id,
          reference: 'IA-X',
          name: 'x',
          assetType: 'nobody_defined_this'
        })
      ),
      refusedBy(/built-in type or one of its organisation's own/)
    );
  });
});

describe('digital assets', () => {
  it("records a domain's registrar and expiry, and drops what its type does not carry", async () => {
    const w = await world('domain');
    const a = await createAsset({
      organisationId: w.org.id,
      entityId: w.main.id,
      details: asset({
        details: { registrar: 'A registrar', seats: 4 },
        expiresAt: new Date(Date.now() + 200 * DAY),
        noticeDays: 30,
        autoRenews: true
      }),
      actor: SYSTEM
    });
    assert.deepEqual(a.details, { registrar: 'A registrar' });
    assert.equal(a.noticeDays, 30);
    assert.equal(a.autoRenews, true);

    const system = await createAsset({
      organisationId: w.org.id,
      entityId: w.main.id,
      details: asset({
        name: 'HR system',
        assetType: 'system',
        expiresAt: new Date(Date.now() + 10 * DAY)
      }),
      actor: SYSTEM
    });
    assert.equal(system.expiresAt, null);

    const sheet = await exportAssets(w.org.id, null);
    const row = sheet.rows.find((r) => r[0] === a.reference)!;
    assert.equal(
      row[sheet.columns.indexOf('Details')],
      'Registrar: A registrar'
    );
    assert.equal(row[sheet.columns.indexOf('Type')], 'Domain');
  });

  it('reminds the owner before a domain lapses, once, and closes the reminder when it is renewed', async () => {
    const w = await world('renew');
    const a = await createAsset({
      organisationId: w.org.id,
      entityId: w.main.id,
      details: asset({
        ownerId: w.admin.id,
        expiresAt: new Date(Date.now() + 40 * DAY),
        noticeDays: 14
      }),
      actor: SYSTEM
    });
    const [due] = await assetsNeedingRenewal(w.org.id);
    assert.equal(due.asset.id, a.id);
    assert.equal(due.ownerMayAct, true);

    assert.equal((await sweepOrganisation(w.org.id)).assetRenewalsRaised, 1);
    assert.equal((await sweepOrganisation(w.org.id)).assetRenewalsRaised, 0);
    const [task] = await remindersFor(w, a.id);
    assert.equal(task.assigneeUserId, w.admin.id);
    assert.match(task.title, /renew or let it lapse by/);

    // Renewed for a year: the old reminder no longer applies.
    await updateAsset({
      id: a.id,
      organisationId: w.org.id,
      details: asset({
        ownerId: w.admin.id,
        expiresAt: new Date(Date.now() + 400 * DAY),
        noticeDays: 14
      }),
      actor: SYSTEM
    });
    const after = await remindersFor(w, a.id);
    assert.deepEqual(
      after.map((t) => t.status),
      ['cancelled']
    );
  });

  it("sends a renewal to the privacy administrators when the owner cannot open the asset's entity", async () => {
    const w = await world('elsewhere');
    const outsider = await w.member(w.other.id);
    const a = await createAsset({
      organisationId: w.org.id,
      entityId: w.main.id,
      details: asset({
        name: 'Certificate',
        assetType: 'certificate',
        ownerId: outsider.id,
        expiresAt: new Date(Date.now() + 5 * DAY)
      }),
      actor: SYSTEM
    });
    await sweepOrganisation(w.org.id);
    const [task] = await remindersFor(w, a.id);
    assert.equal(task.assigneeUserId, null);
    assert.equal(task.assigneeRole, 'privacy_admin');

    await retireAsset({
      id: a.id,
      organisationId: w.org.id,
      reason: 'Replaced',
      actor: SYSTEM
    });
    assert.equal((await remindersFor(w, a.id))[0].status, 'done');
  });
});

describe('contracts and assets', () => {
  it('links a licence to the contract that pays for it, in its own entity only', async () => {
    const w = await world('link');
    const contract = await createContract({
      organisationId: w.org.id,
      entityId: w.main.id,
      supplierId: w.supplier.id,
      details: {
        title: 'Office licences',
        ownerId: null,
        startsAt: null,
        endsAt: new Date(Date.now() + 60 * DAY),
        noticeDays: 30,
        autoRenews: true
      },
      terms: { value: null, currency: null },
      viewerIds: [],
      actor: actorFor(w.admin)
    });
    const licence = await createAsset({
      organisationId: w.org.id,
      entityId: w.main.id,
      details: asset({
        name: 'Office suite',
        assetType: 'software_licence',
        details: { seats: 120 },
        expiresAt: new Date(Date.now() + 80 * DAY)
      }),
      actor: SYSTEM
    });
    await linkAsset({
      assetId: licence.id,
      organisationId: w.org.id,
      kind: 'contract',
      targetId: contract.id,
      actor: SYSTEM
    });
    const loaded = await loadAsset(licence.id, w.org.id);
    assert.equal(loaded?.contracts[0].id, contract.id);
    assert.equal(loaded?.contracts[0].notice, 'due_soon');
    assert.deepEqual(
      (await assetsFor(w.org.id, { contractId: contract.id }, null)).map(
        (a) => [a.id, a.typeLabel]
      ),
      [[licence.id, 'Software licence']]
    );

    const elsewhere = await createAsset({
      organisationId: w.org.id,
      entityId: w.other.id,
      details: asset({ name: 'Other domain' }),
      actor: SYSTEM
    });
    await assert.rejects(
      linkAsset({
        assetId: elsewhere.id,
        organisationId: w.org.id,
        kind: 'contract',
        targetId: contract.id,
        actor: SYSTEM
      }),
      /signed by another legal entity/
    );
  });

  it('lists contract and asset renewals together, soonest notice date first', async () => {
    const w = await world('overview');
    await createContract({
      organisationId: w.org.id,
      entityId: w.main.id,
      supplierId: w.supplier.id,
      details: {
        title: 'Hosting',
        ownerId: null,
        startsAt: null,
        endsAt: new Date(Date.now() + 70 * DAY),
        noticeDays: 10,
        autoRenews: false
      },
      terms: { value: '999', currency: 'GBP' },
      viewerIds: [],
      actor: actorFor(w.admin)
    });
    const domain = await createAsset({
      organisationId: w.org.id,
      entityId: w.main.id,
      details: asset({ expiresAt: new Date(Date.now() + 20 * DAY) }),
      actor: SYSTEM
    });
    await createAsset({
      organisationId: w.org.id,
      entityId: w.main.id,
      details: asset({
        name: 'far.example',
        expiresAt: new Date(Date.now() + 300 * DAY)
      }),
      actor: SYSTEM
    });
    const renewals = await upcomingRenewals(w.org.id, null);
    assert.deepEqual(
      renewals.map((r) => [r.subject, r.title]),
      [
        ['asset', domain.name],
        ['contract', 'Hosting']
      ]
    );
    assert.ok(!JSON.stringify(renewals).includes('999'));
    assert.deepEqual(await upcomingRenewals(w.org.id, [w.other.id]), []);
  });
});
