import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';

import { db, sql as pg } from '@/db/client';
import {
  auditEvents,
  entities,
  informationAssetActivities,
  informationAssets,
  informationAssetSuppliers,
  memberships,
  organisations,
  processingActivities,
  users
} from '@/db/schema';
import { createAssetType, setAssetTypeRetired } from '@/services/asset-types';
import {
  commitImport,
  confirmImportedRecord,
  ImportRefused,
  loadImport,
  previewImport,
  undoImport,
  uploadImport
} from '@/services/imports';
import {
  assetsDueForReview,
  assetsNeedingRenewal,
  linkAsset
} from '@/services/information-assets';
import { createSupplier } from '@/services/third-party';

const SYSTEM = {
  actorKind: 'system' as const,
  actorUserId: null,
  actorLabel: 'asset import test'
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
  const [person] = await db
    .insert(users)
    .values({ email: `Owner-${crypto.randomUUID().slice(0, 8)}@example.com` })
    .returning();
  await db
    .insert(memberships)
    .values({ organisationId: org.id, userId: person.id });
  const [payroll] = await db
    .insert(processingActivities)
    .values({
      organisationId: org.id,
      entityId: entity.id,
      reference: `ROPA-2026-${crypto.randomUUID().slice(0, 4)}`,
      name: 'Payroll'
    })
    .returning();
  const acme = await createSupplier({
    organisationId: org.id,
    name: 'Acme Hosting Ltd',
    categories: [],
    actor: SYSTEM
  });
  return { org, entity, person, payroll, acme };
}

async function imported(organisationId: string, text: string) {
  const batch = await uploadImport({
    organisationId,
    recordType: 'information_asset',
    sourceName: 'OneTrust',
    filename: 'assets.csv',
    contentType: 'text/csv',
    bytes: new TextEncoder().encode(text),
    actor: SYSTEM
  });
  const preview = await previewImport({
    organisationId,
    batchId: batch.id,
    mapping: (await loadImport(batch.id, organisationId))!.mapping,
    actor: SYSTEM
  });
  return { batch, preview };
}

const assetsOf = (organisationId: string) =>
  db
    .select()
    .from(informationAssets)
    .where(eq(informationAssets.organisationId, organisationId))
    .orderBy(informationAssets.name);

describe('importing information assets', () => {
  it('reads types, classifications and owners in its own terms, links what is recorded, and refuses the rest', async () => {
    const w = await world('import-assets');
    const { batch, preview } = await imported(
      w.org.id,
      [
        'ID,Name,Type,Owner,Hosting,Classification,Countries,Processing activities,Suppliers,Expiry date',
        `A-1,HR database,database,${w.person.email.toLowerCase()},Vendor hosted,confidential,UK; Ireland,Payroll,Acme Hosting Ltd,2027-01-31`,
        'A-2,example.org,Domain,someone@elsewhere.test,,Internal,,,,31/03/2027',
        'A-3,Mainframe,Quantum computer,,,,,,,',
        'A-4,Old CRM,Database,,,Top secret,,,,',
        'A-5,Ledger,Database,,,,,Accounts,,',
        'A-6,Files,Database,,,,,,Nobody Ltd,'
      ].join('\n')
    );
    assert.deepEqual(preview, { create: 2, refuse: 4 });
    const rows = (await loadImport(batch.id, w.org.id))!.rows;
    assert.match(
      rows[2].reason ?? '',
      /"Quantum computer" is not an asset type/
    );
    assert.match(rows[3].reason ?? '', /not a level of the neutral scheme/);
    assert.match(rows[4].reason ?? '', /No processing activity "Accounts"/);
    assert.match(rows[5].reason ?? '', /No supplier called "Nobody Ltd"/);

    await commitImport({
      organisationId: w.org.id,
      batchId: batch.id,
      actor: SYSTEM
    });
    const all = await assetsOf(w.org.id);
    const hr = all.find((a) => a.externalRef === 'A-1')!;
    const domain = all.find((a) => a.externalRef === 'A-2')!;
    assert.equal(hr.assetType, 'database');
    assert.equal(hr.hosting, 'saas');
    assert.equal(hr.classification, 'confidential');
    assert.deepEqual(hr.countries, ['UK', 'Ireland']);
    assert.equal(hr.ownerId, w.person.id);
    assert.equal(hr.externalRef, 'A-1');
    assert.equal(hr.importConfirmedAt, null);
    // A database does not expire: the date has nowhere to go.
    assert.equal(hr.expiresAt, null);
    assert.match(hr.reference, /^IA-\d{4}-/);

    assert.equal(domain.assetType, 'domain');
    assert.equal(domain.expiresAt?.toISOString().slice(0, 10), '2027-03-31');
    // An owner who is not a member is kept to read, and the asset shows none.
    assert.equal(domain.ownerId, null);
    assert.equal(domain.legacy?.Owner, 'someone@elsewhere.test');

    const activity = await db
      .select()
      .from(informationAssetActivities)
      .where(eq(informationAssetActivities.assetId, hr.id));
    assert.deepEqual(
      activity.map((l) => l.activityId),
      [w.payroll.id]
    );
    const supplier = await db
      .select()
      .from(informationAssetSuppliers)
      .where(eq(informationAssetSuppliers.assetId, hr.id));
    assert.deepEqual(
      supplier.map((l) => l.supplierId),
      [w.acme.id]
    );

    const [created] = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.subjectId, hr.id),
          eq(auditEvents.action, 'information_asset.created')
        )
      );
    assert.deepEqual((created.after as { imported: unknown }).imported, {
      batch: batch.id,
      ref: 'A-1'
    });
  });

  it('updates on re-import, adding links without removing any, and puts it back on undo', async () => {
    const w = await world('import-assets-again');
    const first = await imported(
      w.org.id,
      // The matching is remembered for the platform, so the column is there
      // from the first file.
      'ID,Name,Type,Retention,Processing activities\nA-1,HR database,Database,Six years,\n'
    );
    await commitImport({
      organisationId: w.org.id,
      batchId: first.batch.id,
      actor: SYSTEM
    });
    const [asset] = await assetsOf(w.org.id);

    const again = await imported(
      w.org.id,
      `ID,Name,Type,Retention,Processing activities\na-1,HR database,Database,,${w.payroll.reference}\n`
    );
    assert.deepEqual(again.preview, { update: 1 });
    await commitImport({
      organisationId: w.org.id,
      batchId: again.batch.id,
      actor: SYSTEM
    });
    const [updated] = await assetsOf(w.org.id);
    assert.equal(updated.id, asset.id);
    // An empty cell keeps what is recorded.
    assert.equal(updated.retention, 'Six years');
    assert.equal(
      (
        await db
          .select()
          .from(informationAssetActivities)
          .where(eq(informationAssetActivities.assetId, asset.id))
      ).length,
      1
    );

    await undoImport({
      organisationId: w.org.id,
      batchId: again.batch.id,
      actor: SYSTEM
    });
    assert.equal(
      (
        await db
          .select()
          .from(informationAssetActivities)
          .where(eq(informationAssetActivities.assetId, asset.id))
      ).length,
      0
    );
    // The links it made do not count as work done on the asset since.
    await undoImport({
      organisationId: w.org.id,
      batchId: first.batch.id,
      actor: SYSTEM
    });
    assert.equal((await assetsOf(w.org.id)).length, 0);
  });

  it('cannot be undone once a person has linked an imported asset', async () => {
    const w = await world('import-assets-linked');
    const { batch } = await imported(
      w.org.id,
      'ID,Name,Type\nA-1,HR database,Database\n'
    );
    await commitImport({
      organisationId: w.org.id,
      batchId: batch.id,
      actor: SYSTEM
    });
    const [asset] = await assetsOf(w.org.id);
    await linkAsset({
      assetId: asset.id,
      organisationId: w.org.id,
      kind: 'supplier',
      targetId: w.acme.id,
      actor: SYSTEM
    });
    await assert.rejects(
      undoImport({
        organisationId: w.org.id,
        batchId: batch.id,
        actor: SYSTEM
      }),
      refused(/linked to other records/)
    );
  });

  it('raises no review or renewal reminders until the asset is confirmed', async () => {
    const w = await world('import-assets-reminders');
    const { batch } = await imported(
      w.org.id,
      'ID,Name,Type,Next review,Expiry date\nA-1,example.org,Domain,2020-01-01,2020-06-30\n'
    );
    await commitImport({
      organisationId: w.org.id,
      batchId: batch.id,
      actor: SYSTEM
    });
    assert.equal((await assetsDueForReview(w.org.id)).length, 0);
    assert.equal((await assetsNeedingRenewal(w.org.id)).length, 0);

    const [asset] = await assetsOf(w.org.id);
    await confirmImportedRecord({
      organisationId: w.org.id,
      type: 'information_asset',
      id: asset.id,
      actor: SYSTEM
    });
    assert.equal((await assetsDueForReview(w.org.id)).length, 1);
    assert.equal((await assetsNeedingRenewal(w.org.id)).length, 1);
  });

  it('clears renewal dates when a re-import changes the type, and keeps a type retired since', async () => {
    const w = await world('import-assets-retype');
    const first = await imported(
      w.org.id,
      'ID,Name,Type,Expiry date\nA-1,example.org,Domain,2027-03-31\nA-2,Old ledger,Legacy store,\n'
    );
    // "Legacy store" is not a type yet, so that row waits.
    assert.deepEqual(first.preview, { create: 1, refuse: 1 });
    await commitImport({
      organisationId: w.org.id,
      batchId: first.batch.id,
      actor: SYSTEM
    });
    const [domain] = await assetsOf(w.org.id);
    assert.ok(domain.expiresAt);

    const again = await imported(
      w.org.id,
      'ID,Name,Type,Expiry date\nA-1,example.org,Database,\n'
    );
    await commitImport({
      organisationId: w.org.id,
      batchId: again.batch.id,
      actor: SYSTEM
    });
    const [database] = await assetsOf(w.org.id);
    assert.equal(database.assetType, 'database');
    assert.equal(database.expiresAt, null);

    // A type retired after the import stays on the asset that has it.
    const type = await createAssetType({
      organisationId: w.org.id,
      type: {
        label: 'Legacy store',
        definition: 'An old store.',
        hasExpiry: false
      },
      actor: SYSTEM
    });
    const third = await imported(
      w.org.id,
      'ID,Name,Type\nA-2,Old ledger,Legacy store\n'
    );
    await commitImport({
      organisationId: w.org.id,
      batchId: third.batch.id,
      actor: SYSTEM
    });
    await setAssetTypeRetired({
      organisationId: w.org.id,
      key: type.key,
      retired: true,
      actor: SYSTEM
    });
    const fourth = await imported(
      w.org.id,
      'ID,Name,Type,Description\nA-2,Old ledger,Legacy store,Kept for audit\nA-3,New ledger,Legacy store,\n'
    );
    assert.deepEqual(fourth.preview, { update: 1, refuse: 1 });
  });
});
