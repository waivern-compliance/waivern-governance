import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { and, eq, sql } from 'drizzle-orm';

import { db, sql as pg, withOrganisation } from '@/db/client';
import {
  auditEvents,
  entities,
  memberships,
  organisations,
  processingActivities,
  roleAssignments,
  supplierContracts,
  suppliers,
  tasks,
  users
} from '@/db/schema';
import type { Grant } from '@/lib/rbac';
import { pathFor } from '@/lib/records';
import { noticeBy, noticeState } from '@/lib/thirdparty/contracts';
import { recommendTier } from '@/lib/thirdparty/tier';
import {
  contractPeople,
  contractRegister,
  contractsNeedingNotice,
  createContract,
  endContract,
  loadContract,
  mayReadContractDocument,
  mayReadContractTerms,
  setContractViewers,
  updateContract,
  type ContractDetails
} from '@/services/contracts';
import { attachDocument, moveDocument } from '@/services/documents';
import { exportContracts } from '@/services/exports';
import { createAsset, linkAsset } from '@/services/information-assets';
import { createActivity } from '@/services/ropa';
import { setSupplierTier, supplierTier } from '@/services/supplier-tier';
import { sweepOrganisation } from '@/services/sweep';
import { createSupplier } from '@/services/third-party';

const DAY = 86_400_000;
const ANALYST: Grant[] = [{ role: 'privacy_analyst', scope: 'organisation' }];
const ADMIN: Grant[] = [{ role: 'privacy_admin', scope: 'organisation' }];

after(() => pg.end());

const refusedBy = (pattern: RegExp) => (error: Error) =>
  pattern.test(
    `${error.message} ${(error.cause as Error | undefined)?.message ?? ''}`
  );

/** A member with an analyst role: across the organisation, or in one entity. */
async function person(
  organisationId: string,
  label: string,
  active = true,
  entityId?: string
) {
  const [user] = await db
    .insert(users)
    .values({
      email: `${label}-${crypto.randomUUID().slice(0, 8)}@example.com`
    })
    .returning();
  const [membership] = await db
    .insert(memberships)
    .values({ organisationId, userId: user.id, isActive: active })
    .returning();
  await db.insert(roleAssignments).values({
    membershipId: membership.id,
    role: 'privacy_analyst',
    ...(entityId ? { scope: 'entity', entityId } : { scope: 'organisation' })
  });
  return user;
}

async function world(label: string) {
  const [org] = await db
    .insert(organisations)
    .values({
      name: `Contracts ${label}`,
      slug: `contracts-${label}-${crypto.randomUUID().slice(0, 8)}`
    })
    .returning();
  const [entity] = await db
    .insert(entities)
    .values({ organisationId: org.id, name: 'Main Ltd', isDefault: true })
    .returning();
  const adder = await person(org.id, 'adder');
  const named = await person(org.id, 'named');
  const other = await person(org.id, 'other');
  const supplier = await createSupplier({
    organisationId: org.id,
    name: `Cloud Host ${label}`,
    actor: SYSTEM
  });
  return { org, entity, adder, named, other, supplier };
}

const SYSTEM = {
  actorKind: 'system' as const,
  actorUserId: null,
  actorLabel: 'contracts test'
};
const actorFor = (user: { id: string; email: string }) => ({
  actorKind: 'user' as const,
  actorUserId: user.id,
  actorLabel: user.email
});

const details = (over: Partial<ContractDetails> = {}): ContractDetails => ({
  title: 'Hosting services agreement',
  ownerId: null,
  startsAt: new Date(Date.now() - 300 * DAY),
  endsAt: new Date(Date.now() + 400 * DAY),
  noticeDays: 90,
  autoRenews: true,
  ...over
});

async function contractIn(
  w: Awaited<ReturnType<typeof world>>,
  over: Partial<ContractDetails> = {}
) {
  return createContract({
    organisationId: w.org.id,
    entityId: w.entity.id,
    supplierId: w.supplier.id,
    details: details(over),
    terms: { value: '120,000.50', currency: 'gbp' },
    viewerIds: [w.named.id],
    actor: actorFor(w.adder)
  });
}

describe('the tier suggestion', () => {
  const none = {
    assetClassifications: [],
    specialCategoryActivities: 0,
    role: 'controller',
    aiInvolvement: null
  };

  it('suggests low, and says why, when nothing points higher', () => {
    assert.deepEqual(recommendTier(none), {
      tier: 'low',
      reasons: ['Nothing recorded points above low']
    });
  });

  it('takes the highest tier any fact points to, and keeps every reason', () => {
    const r = recommendTier({
      ...none,
      role: 'processor',
      specialCategoryActivities: 2,
      assetClassifications: ['internal', 'top_secret']
    });
    assert.equal(r.tier, 'critical');
    assert.equal(r.reasons.length, 3);
    assert.equal(
      recommendTier({ ...none, assetClassifications: ['official_sensitive'] })
        .tier,
      'high'
    );
    assert.equal(
      recommendTier({ ...none, aiInvolvement: 'in_delivery' }).tier,
      'medium'
    );
  });
});

describe('setting a tier', () => {
  it('suggests from the register, and needs a reason to depart from it', async () => {
    const w = await world('tier');
    const asset = await createAsset({
      organisationId: w.org.id,
      entityId: w.entity.id,
      details: {
        name: 'HR system',
        description: null,
        assetType: 'saas_application',
        ownerId: null,
        hosting: 'saas',
        hostedBy: null,
        region: null,
        countries: [],
        classification: 'restricted',
        retention: null,
        nextReviewAt: null
      },
      actor: SYSTEM
    });
    await linkAsset({
      assetId: asset.id,
      organisationId: w.org.id,
      kind: 'supplier',
      targetId: w.supplier.id,
      actor: SYSTEM
    });
    const activity = await createActivity({
      organisationId: w.org.id,
      entityId: w.entity.id,
      name: 'Occupational health',
      recipients: ['Cloud Host - Tier.'],
      actor: SYSTEM
    });
    await db
      .update(processingActivities)
      .set({ specialCategory: true })
      .where(eq(processingActivities.id, activity.id));
    const { recommendation } = await supplierTier(w.org.id, w.supplier.id);
    assert.equal(recommendation.tier, 'critical');

    await assert.rejects(
      setSupplierTier({
        organisationId: w.org.id,
        supplierId: w.supplier.id,
        tier: 'low',
        reason: ' ',
        actor: SYSTEM
      }),
      /suggests critical/
    );
    await setSupplierTier({
      organisationId: w.org.id,
      supplierId: w.supplier.id,
      tier: 'high',
      reason: 'Exit plan tested; data can move in a day',
      actor: SYSTEM
    });
    const [stored] = await db
      .select()
      .from(suppliers)
      .where(eq(suppliers.id, w.supplier.id));
    assert.equal(stored.tier, 'high');
    const [event] = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.subjectId, w.supplier.id),
          eq(auditEvents.action, 'supplier.tier_set')
        )
      );
    const recorded = event.after as Record<string, unknown>;
    assert.equal(recorded.recommended, 'critical');
    assert.equal(recorded.tier, 'high');
    assert.equal(recorded.reason, 'Exit plan tested; data can move in a day');

    // Taking the suggestion needs no reason, and keeps none.
    await setSupplierTier({
      organisationId: w.org.id,
      supplierId: w.supplier.id,
      tier: 'critical',
      reason: null,
      actor: SYSTEM
    });
    assert.equal(
      (await supplierTier(w.org.id, w.supplier.id)).tierReason,
      null
    );
  });

  it('refuses a tier that is not one, written straight to the table too', async () => {
    const w = await world('tier-refuse');
    await assert.rejects(
      setSupplierTier({
        organisationId: w.org.id,
        supplierId: w.supplier.id,
        tier: 'severe',
        reason: null,
        actor: SYSTEM
      }),
      /Choose one of the tiers/
    );
    await assert.rejects(
      db.execute(
        sql`update supplier set tier = 'severe' where id = ${w.supplier.id}`
      ),
      refusedBy(/supplier_tier_known/)
    );
  });
});

describe('contracts', () => {
  it('numbers contracts, cleans the terms and records who added it', async () => {
    const w = await world('create');
    const year = new Date().getUTCFullYear();
    const first = await contractIn(w);
    const second = await contractIn(w, { title: 'Support' });
    assert.equal(first.reference, `CON-${year}-0001`);
    assert.equal(second.reference, `CON-${year}-0002`);
    assert.equal(first.value, '120000.50');
    assert.equal(first.currency, 'GBP');
    assert.equal(first.createdBy, w.adder.id);
  });

  it('refuses bad terms and dates', async () => {
    const w = await world('refuse');
    const make = (
      over: Partial<ContractDetails>,
      terms = { value: '100', currency: 'GBP' }
    ) =>
      createContract({
        organisationId: w.org.id,
        entityId: w.entity.id,
        supplierId: w.supplier.id,
        details: details(over),
        terms,
        viewerIds: [],
        actor: actorFor(w.adder)
      });
    await assert.rejects(make({ title: ' ' }), /title/);
    await assert.rejects(
      make({
        startsAt: new Date(Date.now() + DAY),
        endsAt: new Date(Date.now() - DAY)
      }),
      /end before it starts/
    );
    await assert.rejects(make({ noticeDays: -1 }), /whole number/);
    await assert.rejects(
      make({}, { value: 'lots', currency: 'GBP' }),
      /as an amount/
    );
    await assert.rejects(
      make({}, { value: '100', currency: 'pounds' }),
      /three-letter/
    );
    await assert.rejects(make({}, { value: '100', currency: '' }), /currency/);
  });

  it('shows the terms to whoever added it, the people named and holders of contract.confidential only', async () => {
    const w = await world('terms');
    const contract = await contractIn(w);
    const view = async (userId: string, grants: Grant[]) =>
      loadContract(contract.id, w.org.id, { userId, grants });

    for (const [who, grants] of [
      [w.adder.id, ANALYST],
      [w.named.id, ANALYST],
      [w.other.id, ADMIN]
    ] as const) {
      const row = await view(who, [...grants]);
      assert.equal(row?.termsVisible, true);
      assert.equal(row?.contract.value, '120000.50');
    }
    const hidden = await view(w.other.id, ANALYST);
    assert.equal(hidden?.termsVisible, false);
    assert.equal(hidden?.contract.value, null);
    assert.equal(hidden?.contract.currency, null);
    assert.deepEqual(hidden?.named, []);
    // The dates are everybody's: renewals are never hidden.
    assert.ok(hidden?.noticeBy);

    const listed = await contractRegister(w.org.id, null, {
      userId: w.other.id,
      grants: ANALYST
    });
    assert.ok(listed.every((r) => r.contract.value === null));
  });

  it('lets only those who may see the terms change them or who sees them', async () => {
    const w = await world('change');
    const contract = await contractIn(w);
    const outsider = { userId: w.other.id, grants: ANALYST };
    await assert.rejects(
      updateContract({
        id: contract.id,
        organisationId: w.org.id,
        details: details(),
        terms: { value: '1', currency: 'GBP' },
        viewer: outsider,
        actor: actorFor(w.other)
      }),
      /commercial terms/
    );
    // Without terms, anyone who may write can keep the dates current.
    await updateContract({
      id: contract.id,
      organisationId: w.org.id,
      details: details({ noticeDays: 30 }),
      viewer: outsider,
      actor: actorFor(w.other)
    });
    await assert.rejects(
      setContractViewers({
        id: contract.id,
        organisationId: w.org.id,
        userIds: [w.other.id],
        viewer: { userId: w.named.id, grants: ANALYST },
        actor: actorFor(w.named)
      }),
      /Only whoever added the contract/
    );
    await setContractViewers({
      id: contract.id,
      organisationId: w.org.id,
      userIds: [w.named.id, w.other.id],
      viewer: { userId: w.adder.id, grants: ANALYST },
      actor: actorFor(w.adder)
    });
    assert.ok(
      await mayReadContractTerms(w.org.id, contract.id, outsider),
      'a newly named member could not see the terms'
    );
  });

  it('names only current members of the organisation', async () => {
    const w = await world('viewers');
    const v = await world('viewers-other');
    const leaver = await person(w.org.id, 'leaver', false);
    for (const userId of [v.named.id, leaver.id])
      await assert.rejects(
        createContract({
          organisationId: w.org.id,
          entityId: w.entity.id,
          supplierId: w.supplier.id,
          details: details(),
          terms: { value: null, currency: null },
          viewerIds: [userId],
          actor: actorFor(w.adder)
        }),
        /current members/
      );
    const contract = await contractIn(w);
    await assert.rejects(
      db.execute(sql`
        insert into supplier_contract_viewer (organisation_id, contract_id, user_id)
        values (${w.org.id}, ${contract.id}, ${v.named.id})`),
      refusedBy(/member of the organisation/)
    );
  });

  it("refuses another organisation's supplier or entity", async () => {
    const w = await world('tenancy');
    const v = await world('tenancy-other');
    await assert.rejects(
      createContract({
        organisationId: w.org.id,
        entityId: w.entity.id,
        supplierId: v.supplier.id,
        details: details(),
        terms: { value: null, currency: null },
        viewerIds: [],
        actor: actorFor(w.adder)
      }),
      /No such third party/
    );
    await assert.rejects(
      createContract({
        organisationId: w.org.id,
        entityId: v.entity.id,
        supplierId: w.supplier.id,
        details: details(),
        terms: { value: null, currency: null },
        viewerIds: [],
        actor: actorFor(w.adder)
      }),
      /No such legal entity/
    );
    await assert.rejects(
      db.execute(sql`
        insert into supplier_contract (organisation_id, entity_id, supplier_id, reference, title)
        values (${w.org.id}, ${w.entity.id}, ${v.supplier.id}, 'CON-X', 'Planted')`),
      refusedBy(/its own organisation/)
    );
    await contractIn(w);
    await contractIn(v);
    await withOrganisation(w.org.id, async () => {
      for (const table of ['supplier_contract', 'supplier_contract_viewer']) {
        const rows = (await db.execute(
          sql`select organisation_id from ${sql.identifier(table)}`
        )) as unknown as Array<{ organisation_id: string }>;
        assert.ok(rows.length > 0);
        assert.ok(
          rows.every((r) => r.organisation_id === w.org.id),
          `${table} showed another organisation's row`
        );
      }
    });
  });

  it('never writes the terms to the audit trail', async () => {
    const w = await world('audit');
    const contract = await contractIn(w);
    await updateContract({
      id: contract.id,
      organisationId: w.org.id,
      details: details(),
      terms: { value: '99999', currency: 'EUR' },
      viewer: { userId: w.adder.id, grants: ANALYST },
      actor: actorFor(w.adder)
    });
    const events = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.subjectId, contract.id));
    assert.deepEqual(events.map((e) => e.action).sort(), [
      'supplier_contract.created',
      'supplier_contract.updated'
    ]);
    const text = JSON.stringify(events.map((e) => [e.before, e.after]));
    for (const secret of ['120000', '99999', 'EUR', 'GBP'])
      assert.ok(!text.includes(secret), `the audit trail held ${secret}`);
    const updated = events.find(
      (e) => e.action === 'supplier_contract.updated'
    );
    assert.equal(
      (updated?.after as Record<string, unknown>).termsChanged,
      true
    );
  });

  it('keeps the signed copy to those who may see the terms, and will not move it out', async () => {
    const w = await world('document');
    const contract = await contractIn(w);
    const doc = await attachDocument({
      organisationId: w.org.id,
      entityId: w.entity.id,
      subjectType: 'supplier_contract',
      subjectId: contract.id,
      filename: 'signed.pdf',
      contentType: 'application/pdf',
      content: Buffer.from('%PDF-1.7\nsigned contract\n'),
      actor: SYSTEM
    });
    assert.equal(
      await mayReadContractDocument(w.org.id, doc.id, {
        userId: w.named.id,
        grants: ANALYST
      }),
      true
    );
    assert.equal(
      await mayReadContractDocument(w.org.id, doc.id, {
        userId: w.other.id,
        grants: ANALYST
      }),
      false
    );
    await assert.rejects(
      moveDocument({
        id: doc.id,
        organisationId: w.org.id,
        subjectType: 'supplier',
        subjectId: w.supplier.id,
        actor: SYSTEM
      }),
      /third party or its agreement/
    );
  });

  it('withholds the terms in the spreadsheet from those who may not see them', async () => {
    const w = await world('export');
    await contractIn(w);
    const hidden = await exportContracts(w.org.id, null, {
      userId: w.other.id,
      grants: ANALYST
    });
    const shown = await exportContracts(w.org.id, null, {
      userId: w.named.id,
      grants: ANALYST
    });
    const at = hidden.columns.indexOf('Value');
    assert.equal(hidden.rows[0][at], 'withheld');
    assert.equal(shown.rows[0][at], '120000.50');
    assert.equal(
      (await exportContracts(w.org.id, null)).rows[0][at],
      'withheld'
    );
  });
});

describe('notice', () => {
  it('falls due the notice period before the end date', () => {
    const endsAt = new Date('2027-06-30T00:00:00Z');
    assert.equal(
      noticeBy({ endsAt, noticeDays: 90, autoRenews: false, endedAt: null })
        ?.toISOString()
        .slice(0, 10),
      '2027-04-01'
    );
    assert.equal(
      noticeBy({
        endsAt: null,
        noticeDays: 90,
        autoRenews: false,
        endedAt: null
      }),
      null
    );
    const now = new Date('2027-01-15T00:00:00Z');
    assert.equal(
      noticeState(
        { endsAt, noticeDays: 90, autoRenews: false, endedAt: null },
        now
      ),
      'due_soon'
    );
    assert.equal(
      noticeState(
        { endsAt, noticeDays: 0, autoRenews: false, endedAt: null },
        now
      ),
      'later'
    );
    assert.equal(
      noticeState(
        { endsAt, noticeDays: 90, autoRenews: false, endedAt: null },
        new Date('2027-05-01T00:00:00Z')
      ),
      'passed'
    );
    assert.equal(
      noticeState(
        { endsAt, noticeDays: 90, autoRenews: false, endedAt: now },
        now
      ),
      'ended'
    );
  });

  it('calls a contract that renewed on its own renewed, not overdue', () => {
    const endsAt = new Date('2027-06-30T00:00:00Z');
    const after = new Date('2027-07-15T00:00:00Z');
    const dates = { endsAt, noticeDays: 90, endedAt: null };
    assert.equal(noticeState({ ...dates, autoRenews: true }, after), 'renewed');
    assert.equal(noticeState({ ...dates, autoRenews: false }, after), 'passed');
  });

  it('links its reminders to the contract', () => {
    assert.equal(pathFor('supplier_contract', 'c1'), '/app/contracts/c1');
    assert.equal(pathFor('information_asset', 'a1'), '/app/assets/a1');
  });

  it('raises one task per notice date to the owner, naming no terms, and none once ended', async () => {
    const w = await world('sweep');
    const due = await contractIn(w, {
      ownerId: w.named.id,
      endsAt: new Date(Date.now() + 120 * DAY),
      noticeDays: 60
    });
    const ended = await contractIn(w, {
      endsAt: new Date(Date.now() + 100 * DAY),
      noticeDays: 30
    });
    await endContract({
      id: ended.id,
      organisationId: w.org.id,
      reason: 'Replaced',
      actor: SYSTEM
    });
    await contractIn(w, { endsAt: new Date(Date.now() + 900 * DAY) });
    assert.deepEqual(
      (await contractsNeedingNotice(w.org.id)).map((r) => r.contract.id),
      [due.id]
    );

    const result = await sweepOrganisation(w.org.id);
    assert.equal(result.contractNoticesRaised, 1);
    const raised = await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.organisationId, w.org.id),
          eq(tasks.subjectType, 'supplier_contract')
        )
      );
    assert.equal(raised.length, 1);
    assert.equal(raised[0].assigneeUserId, w.named.id);
    assert.ok(
      !`${raised[0].title} ${raised[0].description}`.includes('120000')
    );
    assert.equal((await sweepOrganisation(w.org.id)).contractNoticesRaised, 0);
  });

  async function reminders(organisationId: string) {
    return db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.organisationId, organisationId),
          eq(tasks.subjectType, 'supplier_contract')
        )
      );
  }

  it('closes the reminder when the contract ends', async () => {
    const w = await world('end-closes');
    const c = await contractIn(w, {
      ownerId: w.named.id,
      endsAt: new Date(Date.now() + 120 * DAY),
      noticeDays: 60
    });
    await sweepOrganisation(w.org.id);
    await endContract({
      id: c.id,
      organisationId: w.org.id,
      reason: 'Terminated',
      actor: SYSTEM
    });
    const [task] = await reminders(w.org.id);
    assert.equal(task.status, 'done');
  });

  it('replaces the reminder when the dates change', async () => {
    const w = await world('redate');
    const c = await contractIn(w, {
      ownerId: w.named.id,
      endsAt: new Date(Date.now() + 120 * DAY),
      noticeDays: 60
    });
    await sweepOrganisation(w.org.id);
    await updateContract({
      id: c.id,
      organisationId: w.org.id,
      details: details({
        ownerId: w.named.id,
        endsAt: new Date(Date.now() + 130 * DAY),
        noticeDays: 60
      }),
      viewer: { userId: w.adder.id, grants: ANALYST },
      actor: actorFor(w.adder)
    });
    assert.deepEqual(
      (await reminders(w.org.id)).map((t) => t.status),
      ['cancelled']
    );
    assert.equal((await sweepOrganisation(w.org.id)).contractNoticesRaised, 1);
    const open = (await reminders(w.org.id)).filter((t) => t.status === 'open');
    assert.equal(open.length, 1);
    assert.equal(
      open[0].dueAt?.toISOString().slice(0, 10),
      new Date(Date.now() + 70 * DAY).toISOString().slice(0, 10)
    );
  });

  it('asks for the new term once an automatic renewal has happened, and retires the notice reminder', async () => {
    const w = await world('renewed');
    const c = await contractIn(w, {
      ownerId: w.named.id,
      endsAt: new Date(Date.now() + 20 * DAY),
      noticeDays: 30,
      autoRenews: true
    });
    await sweepOrganisation(w.org.id);
    // The term ends and it renews; nobody records the new end date.
    await withOrganisation(w.org.id, () =>
      db
        .update(supplierContracts)
        .set({ endsAt: new Date(Date.now() - 2 * DAY) })
        .where(eq(supplierContracts.id, c.id))
    );
    const [due] = await contractsNeedingNotice(w.org.id);
    assert.equal(due.notice, 'renewed');
    assert.equal((await sweepOrganisation(w.org.id)).contractNoticesRaised, 1);
    const all = await reminders(w.org.id);
    assert.deepEqual(
      all.map((t) => [t.idempotencyKey?.split(':')[0], t.status]).sort(),
      [
        ['contract-notice', 'cancelled'],
        ['contract-renewed', 'open']
      ]
    );
  });

  it('sends the reminder to the privacy administrators when the owner cannot open the contract', async () => {
    const w = await world('owner-scope');
    const c = await contractIn(w, {
      ownerId: w.named.id,
      endsAt: new Date(Date.now() + 120 * DAY),
      noticeDays: 60
    });
    // The owner's access is narrowed to another entity after they were named.
    const [elsewhere] = await db
      .insert(entities)
      .values({ organisationId: w.org.id, name: 'Elsewhere Ltd' })
      .returning();
    const [membership] = await db
      .select()
      .from(memberships)
      .where(eq(memberships.userId, w.named.id));
    await db
      .update(roleAssignments)
      .set({ scope: 'entity', entityId: elsewhere.id })
      .where(eq(roleAssignments.membershipId, membership.id));
    const [due] = await contractsNeedingNotice(w.org.id);
    assert.equal(due.contract.id, c.id);
    assert.equal(due.ownerMayAct, false);
    await sweepOrganisation(w.org.id);
    const [task] = await reminders(w.org.id);
    assert.equal(task.assigneeUserId, null);
    assert.equal(task.assigneeRole, 'privacy_admin');
  });
});

describe('who can be named', () => {
  it('offers and accepts only members who can open records in the entity that signed', async () => {
    const w = await world('people');
    const [elsewhere] = await db
      .insert(entities)
      .values({ organisationId: w.org.id, name: 'Elsewhere Ltd' })
      .returning();
    const confined = await person(w.org.id, 'confined', true, elsewhere.id);
    const people = (await contractPeople(w.org.id, w.entity.id)).map(
      (p) => p.id
    );
    assert.ok(people.includes(w.named.id));
    assert.ok(!people.includes(confined.id));
    assert.ok(
      (await contractPeople(w.org.id, elsewhere.id))
        .map((p) => p.id)
        .includes(confined.id)
    );

    await assert.rejects(
      contractIn(w, { ownerId: confined.id }),
      refusedBy(/can see records in the entity/)
    );
    const c = await contractIn(w);
    await assert.rejects(
      setContractViewers({
        id: c.id,
        organisationId: w.org.id,
        userIds: [w.named.id, confined.id],
        viewer: { userId: w.adder.id, grants: ANALYST },
        actor: actorFor(w.adder)
      }),
      refusedBy(/can see records in the entity/)
    );
  });
});
