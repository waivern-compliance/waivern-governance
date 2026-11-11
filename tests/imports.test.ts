import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';

import { db, sql as pg } from '@/db/client';
import {
  auditEvents,
  entities,
  organisations,
  processingActivities,
  suppliers
} from '@/db/schema';
import {
  convertRow,
  guessMapping,
  readDate,
  readTransfers,
  splitList
} from '@/lib/import/fields';
import { parseCsv, toTable } from '@/lib/import/parse';
import { mayImport } from '@/lib/rbac';
import {
  commitImport,
  confirmImportedActivity,
  ImportRefused,
  loadImport,
  previewImport,
  undoImport,
  uploadImport
} from '@/services/imports';
import { article30Gaps } from '@/services/ropa';
import { article28Gaps, createSupplier } from '@/services/third-party';

const SYSTEM = {
  actorKind: 'system' as const,
  actorUserId: null,
  actorLabel: 'import test'
};

after(() => pg.end());

const csv = (text: string) => new TextEncoder().encode(text);
const refused = (pattern: RegExp) => (e: unknown) =>
  e instanceof ImportRefused && pattern.test(e.message);

describe('reading a file', () => {
  it('reads CSV with quotes, line breaks in cells, and semicolons', () => {
    assert.deepEqual(
      parseCsv('﻿Name,Purpose\r\n"Payroll, UK","Pay staff\nand ""reward"""\n'),
      [
        ['Name', 'Purpose'],
        ['Payroll, UK', 'Pay staff\nand "reward"']
      ]
    );
    assert.deepEqual(parseCsv('a;b\n1;2'), [
      ['a', 'b'],
      ['1', '2']
    ]);
  });

  it('needs named, distinct columns', () => {
    assert.throws(() => toTable([['Name', 'Blank', '', 'X']]), /blank/);
    assert.throws(() => toTable([['Name', 'name']]), /Two columns/);
    assert.deepEqual(toTable([['Name', ''], [], ['A']]), {
      columns: ['Name'],
      rows: [['A']]
    });
  });
});

describe('reading a row', () => {
  it('matches columns by their usual names', () => {
    assert.deepEqual(
      guessMapping('processing_activity', [
        'ID',
        'Activity Name',
        'Legal Basis',
        'Owner'
      ]).fields,
      { externalRef: 'ID', name: 'Activity Name', lawfulBasis: 'Legal Basis' }
    );
  });

  it('reads lists, dates, roles and transfers, and refuses what it cannot read', () => {
    assert.deepEqual(splitList('HR; Payroll | Pensions\nTax'), [
      'HR',
      'Payroll',
      'Pensions',
      'Tax'
    ]);
    assert.equal(readDate('31/03/2026'), '2026-03-31T00:00:00.000Z');
    assert.throws(() => readDate('31/02/2026'), /not a real date/);
    assert.deepEqual(
      readTransfers('United States (SCCs); India: IDTA; Canada'),
      [
        { country: 'United States', mechanism: 'SCCs' },
        { country: 'India', mechanism: 'IDTA' },
        { country: 'Canada' }
      ]
    );
    const mapping = {
      fields: { externalRef: 'ID', name: 'Name', controllerRole: 'Role' },
      keepUnmapped: true
    };
    const ok = convertRow('processing_activity', mapping, {
      ID: 'OT-1',
      Name: 'Payroll',
      Role: 'Joint Controller',
      Owner: 'Ana'
    });
    assert.equal(ok.action, 'ok');
    if (ok.action === 'ok') {
      assert.equal(ok.record.data.name, 'Payroll');
      assert.deepEqual(ok.record.legacy, { Owner: 'Ana' });
    }
    const bad = convertRow('processing_activity', mapping, {
      ID: 'OT-2',
      Name: 'X',
      Role: 'Sponsor',
      Owner: ''
    });
    assert.equal(bad.action, 'refuse');
    const unnamed = convertRow('processing_activity', mapping, {
      ID: 'OT-3',
      Name: '',
      Role: '',
      Owner: 'x'
    });
    assert.equal(unnamed.action, 'refuse');
    assert.equal(
      convertRow('processing_activity', mapping, {
        ID: '',
        Name: '',
        Role: '',
        Owner: ''
      }).action,
      'skip'
    );
  });
});

async function anOrg(label: string) {
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
  return { org, entity };
}

const ACTIVITIES = `ID,Name,Purpose,Legal Basis,Data Categories,Owner
OT-1,Payroll,Pay staff,Contract,Bank details; Salary,Finance
OT-2,Marketing emails,Newsletters,Consent,Email address,Marketing
OT-3,,Missing name,,,
OT-1,Payroll again,Duplicate,,,
`;

describe('importing processing activities', () => {
  it('previews, imports as one step, keeps provenance, and re-imports as an update', async () => {
    const { org, entity } = await anOrg('import-ropa');
    const upload = () =>
      uploadImport({
        organisationId: org.id,
        recordType: 'processing_activity',
        sourceName: 'OneTrust',
        filename: 'ropa.csv',
        contentType: 'text/csv',
        bytes: csv(ACTIVITIES),
        actor: SYSTEM
      });
    const batch = await upload();
    const loaded = await loadImport(batch.id, org.id);
    assert.equal(loaded?.batch.rowCount, 4);
    assert.equal(loaded?.mapping.fields.name, 'Name');

    await assert.rejects(
      commitImport({
        organisationId: org.id,
        batchId: batch.id,
        actor: SYSTEM
      }),
      refused(/Preview it first/)
    );
    await assert.rejects(
      previewImport({
        organisationId: org.id,
        batchId: batch.id,
        mapping: { fields: { externalRef: 'ID' }, keepUnmapped: true },
        actor: SYSTEM
      }),
      refused(/holds name/)
    );
    const counts = await previewImport({
      organisationId: org.id,
      batchId: batch.id,
      mapping: loaded!.mapping,
      actor: SYSTEM
    });
    assert.deepEqual(counts, { create: 2, refuse: 2 });
    // Nothing written by the preview.
    assert.equal(
      (
        await db
          .select()
          .from(processingActivities)
          .where(eq(processingActivities.organisationId, org.id))
      ).length,
      0
    );

    assert.deepEqual(
      await commitImport({
        organisationId: org.id,
        batchId: batch.id,
        actor: SYSTEM
      }),
      { create: 2, refuse: 2 }
    );
    const [payroll] = await db
      .select()
      .from(processingActivities)
      .where(
        and(
          eq(processingActivities.organisationId, org.id),
          eq(processingActivities.externalRef, 'OT-1')
        )
      );
    assert.equal(payroll.name, 'Payroll');
    assert.equal(payroll.entityId, entity.id);
    assert.deepEqual(payroll.lawfulBases, ['contract']);
    assert.deepEqual(payroll.dataCategories, ['Bank details', 'Salary']);
    assert.deepEqual(payroll.legacy, { Owner: 'Finance' });
    assert.equal(payroll.importConfirmedAt, null);
    assert.equal(payroll.importBatchId, batch.id);

    // The same file again, from the same platform: updates, never duplicates.
    const again = await upload();
    const offered = (await loadImport(again.id, org.id))!.mapping;
    assert.deepEqual(
      await previewImport({
        organisationId: org.id,
        batchId: again.id,
        mapping: offered,
        actor: SYSTEM
      }),
      { update: 2, refuse: 2 }
    );
    await commitImport({
      organisationId: org.id,
      batchId: again.id,
      actor: SYSTEM
    });
    assert.equal(
      (
        await db
          .select()
          .from(processingActivities)
          .where(eq(processingActivities.organisationId, org.id))
      ).length,
      2
    );

    // Undoing the second import puts back what the first one wrote.
    await undoImport({
      organisationId: org.id,
      batchId: again.id,
      actor: SYSTEM
    });
    const [restored] = await db
      .select()
      .from(processingActivities)
      .where(eq(processingActivities.id, payroll.id));
    assert.equal(restored.importBatchId, batch.id);
    assert.equal(restored.updatedAt.getTime(), payroll.updatedAt.getTime());

    // Once a person has worked on a record, the first import stays.
    await confirmImportedActivity({
      organisationId: org.id,
      activityId: payroll.id,
      actor: SYSTEM
    });
    await assert.rejects(
      undoImport({ organisationId: org.id, batchId: batch.id, actor: SYSTEM }),
      refused(/changed since it was imported/)
    );

    const actions = (
      await db
        .select({ action: auditEvents.action })
        .from(auditEvents)
        .where(eq(auditEvents.organisationId, org.id))
    ).map((e) => e.action);
    for (const a of [
      'import.uploaded',
      'import.committed',
      'import.undone',
      'processing_activity.import_confirmed'
    ])
      assert.ok(actions.includes(a), a);
  });

  it('can be undone while untouched, removing what it created', async () => {
    const { org } = await anOrg('import-undo');
    const batch = await uploadImport({
      organisationId: org.id,
      recordType: 'processing_activity',
      sourceName: 'Vanta',
      filename: 'ropa.csv',
      contentType: 'text/csv',
      bytes: csv('ID,Name\nV-1,Payroll\n'),
      actor: SYSTEM
    });
    await previewImport({
      organisationId: org.id,
      batchId: batch.id,
      mapping: (await loadImport(batch.id, org.id))!.mapping,
      actor: SYSTEM
    });
    await commitImport({
      organisationId: org.id,
      batchId: batch.id,
      actor: SYSTEM
    });
    assert.deepEqual(
      await undoImport({
        organisationId: org.id,
        batchId: batch.id,
        actor: SYSTEM
      }),
      { removed: 1, restored: 0 }
    );
    assert.equal(
      (
        await db
          .select()
          .from(processingActivities)
          .where(eq(processingActivities.organisationId, org.id))
      ).length,
      0
    );
    await assert.rejects(
      undoImport({ organisationId: org.id, batchId: batch.id, actor: SYSTEM }),
      refused(/Only an import that has been made/)
    );
  });
});

describe('importing suppliers', () => {
  it('adds to a supplier already recorded, and puts it back on undo', async () => {
    const { org } = await anOrg('import-vendors');
    const known = await createSupplier({
      organisationId: org.id,
      name: 'Acme Hosting Ltd',
      categories: ['Hosting'],
      actor: SYSTEM
    });
    const batch = await uploadImport({
      organisationId: org.id,
      recordType: 'supplier',
      sourceName: 'Vanta',
      filename: 'vendors.csv',
      contentType: 'text/csv',
      bytes: csv(
        'Vendor Name,Category,Risk Tier\nAcme Hosting Ltd,Hosting; Backups,High\nMailer Co,Email,Low\nmailer co,Email,Low\n'
      ),
      actor: SYSTEM
    });
    const counts = await previewImport({
      organisationId: org.id,
      batchId: batch.id,
      mapping: (await loadImport(batch.id, org.id))!.mapping,
      actor: SYSTEM
    });
    assert.deepEqual(counts, { merge: 1, create: 1, refuse: 1 });
    await commitImport({
      organisationId: org.id,
      batchId: batch.id,
      actor: SYSTEM
    });
    const [merged] = await db
      .select()
      .from(suppliers)
      .where(eq(suppliers.id, known.id));
    assert.deepEqual(merged.categories.sort(), ['Backups', 'Hosting']);
    assert.deepEqual(merged.legacy, { 'Risk Tier': 'High' });
    // Typed in by a person, so still confirmed.
    assert.ok(merged.reviewedAt);
    const [mailer] = await db
      .select()
      .from(suppliers)
      .where(
        and(
          eq(suppliers.organisationId, org.id),
          eq(suppliers.name, 'Mailer Co')
        )
      );
    assert.equal(mailer.reviewedAt, null);

    await undoImport({
      organisationId: org.id,
      batchId: batch.id,
      actor: SYSTEM
    });
    const [back] = await db
      .select()
      .from(suppliers)
      .where(eq(suppliers.id, known.id));
    assert.deepEqual(back.categories, ['Hosting']);
    assert.equal(back.legacy, null);
    assert.ok(back.reviewedAt);
    assert.equal(
      (
        await db
          .select()
          .from(suppliers)
          .where(eq(suppliers.organisationId, org.id))
      ).length,
      1
    );
  });

  it('reads an Excel workbook', async () => {
    const { org } = await anOrg('import-xlsx');
    const batch = await uploadImport({
      organisationId: org.id,
      recordType: 'supplier',
      sourceName: 'Vanta',
      filename: 'vendors.xlsx',
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      bytes: new Uint8Array(
        readFileSync(new URL('./fixtures/vendors.xlsx', import.meta.url))
      ),
      actor: SYSTEM
    });
    const loaded = await loadImport(batch.id, org.id);
    assert.deepEqual(loaded?.batch.columns, [
      'Vendor Name',
      'Category',
      'Risk Tier'
    ]);
    assert.equal(loaded?.batch.rowCount, 2);
    assert.deepEqual(
      await previewImport({
        organisationId: org.id,
        batchId: batch.id,
        mapping: loaded!.mapping,
        actor: SYSTEM
      }),
      { create: 2 }
    );
  });

  it('refuses a file it cannot read, and only lets organisation configurers import', async () => {
    const { org } = await anOrg('import-refused');
    await assert.rejects(
      uploadImport({
        organisationId: org.id,
        recordType: 'supplier',
        sourceName: 'Vanta',
        filename: 'x.csv',
        contentType: 'text/csv',
        bytes: new Uint8Array([0xff, 0xfe, 0x00]),
        actor: SYSTEM
      }),
      refused(/UTF-8/)
    );
    await assert.rejects(
      uploadImport({
        organisationId: org.id,
        recordType: 'supplier',
        sourceName: ' ',
        filename: 'x.csv',
        contentType: 'text/csv',
        bytes: csv('Name\nA\n'),
        actor: SYSTEM
      }),
      refused(/Name the platform/)
    );
    assert.equal(
      mayImport([
        { scope: 'organisation', role: 'owner', entityId: null } as never
      ]),
      true
    );
    assert.equal(
      mayImport([{ scope: 'entity', role: 'owner', entityId: 'x' } as never]),
      false
    );
  });
});

/** Upload, preview with the offered matching, and import. */
async function importFile(
  organisationId: string,
  recordType: 'processing_activity' | 'supplier',
  text: string,
  entityId?: string
) {
  const batch = await uploadImport({
    organisationId,
    recordType,
    sourceName: 'OneTrust',
    entityId,
    filename: 'file.csv',
    contentType: 'text/csv',
    bytes: csv(text),
    actor: SYSTEM
  });
  const preview = await previewImport({
    organisationId,
    batchId: batch.id,
    mapping: (await loadImport(batch.id, organisationId))!.mapping,
    actor: SYSTEM
  });
  const committed = await commitImport({
    organisationId,
    batchId: batch.id,
    actor: SYSTEM
  });
  return { batch, preview, committed };
}

describe('what an import leaves behind', () => {
  it('shows imported records as unconfirmed until a person confirms them', async () => {
    const { org } = await anOrg('import-gaps');
    await importFile(org.id, 'processing_activity', 'ID,Name\nG-1,Payroll\n');
    const [activity] = await db
      .select()
      .from(processingActivities)
      .where(eq(processingActivities.organisationId, org.id));
    assert.ok(
      article30Gaps(activity, new Set()).includes('import_unconfirmed')
    );
    const confirmed = await confirmImportedActivity({
      organisationId: org.id,
      activityId: activity.id,
      actor: SYSTEM
    });
    assert.ok(
      !article30Gaps(confirmed, new Set()).includes('import_unconfirmed')
    );

    await importFile(org.id, 'supplier', 'Vendor Name\nMailer Co\n');
    const [supplier] = await db
      .select()
      .from(suppliers)
      .where(eq(suppliers.organisationId, org.id));
    assert.ok(article28Gaps(supplier, []).includes('never_reviewed'));
  });

  it('clears lawful bases a re-import no longer states', async () => {
    const { org } = await anOrg('import-bases');
    await importFile(
      org.id,
      'processing_activity',
      'ID,Name,Legal Basis\nB-1,Payroll,Contract\n'
    );
    await importFile(
      org.id,
      'processing_activity',
      'ID,Name,Legal Basis\nB-1,Payroll,See the LIA\n'
    );
    const [activity] = await db
      .select()
      .from(processingActivities)
      .where(eq(processingActivities.organisationId, org.id));
    assert.equal(activity.lawfulBasis, 'See the LIA');
    assert.deepEqual(activity.lawfulBases, []);
  });

  it('refuses two supplier rows with one identifier, and leaves a supplier typed in as it was', async () => {
    const { org } = await anOrg('import-vendor-ref');
    const known = await createSupplier({
      organisationId: org.id,
      name: 'Acme',
      categories: [],
      actor: SYSTEM
    });
    const { preview } = await importFile(
      org.id,
      'supplier',
      'ID,Vendor Name\nV-1,Acme\nV-2,Mailer Co\nV-2,Mailer Cloud\n'
    );
    assert.deepEqual(preview, { merge: 1, create: 1, refuse: 1 });
    const [merged] = await db
      .select()
      .from(suppliers)
      .where(eq(suppliers.id, known.id));
    assert.equal(merged.importSourceId, null);
    assert.equal(merged.externalRef, null);
  });

  it('refuses to move an activity into another legal entity', async () => {
    const { org } = await anOrg('import-entity');
    const [other] = await db
      .insert(entities)
      .values({ organisationId: org.id, name: 'Other' })
      .returning();
    await importFile(org.id, 'processing_activity', 'ID,Name\nE-1,Payroll\n');
    const { preview } = await importFile(
      org.id,
      'processing_activity',
      'ID,Name\nE-1,Payroll\n',
      other.id
    );
    assert.deepEqual(preview, { refuse: 1 });
  });

  it('records each record undo removes', async () => {
    const { org } = await anOrg('import-undo-audit');
    const { batch } = await importFile(
      org.id,
      'processing_activity',
      'ID,Name\nU-1,Payroll\n'
    );
    const [activity] = await db
      .select()
      .from(processingActivities)
      .where(eq(processingActivities.organisationId, org.id));
    await undoImport({
      organisationId: org.id,
      batchId: batch.id,
      actor: SYSTEM
    });
    const events = await db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organisationId, org.id),
          eq(auditEvents.subjectId, activity.id)
        )
      );
    assert.ok(events.some((e) => e.action === 'processing_activity.deleted'));
  });

  it('lets two first uploads from one platform land on the same source', async () => {
    const { org } = await anOrg('import-race');
    const upload = () =>
      uploadImport({
        organisationId: org.id,
        recordType: 'supplier',
        sourceName: 'Brand New Platform',
        filename: 'v.csv',
        contentType: 'text/csv',
        bytes: csv('Vendor Name\nAcme\n'),
        actor: SYSTEM
      });
    const [a, b] = await Promise.all([upload(), upload()]);
    const [la, lb] = await Promise.all([
      loadImport(a.id, org.id),
      loadImport(b.id, org.id)
    ]);
    assert.equal(la!.batch.sourceId, lb!.batch.sourceId);
  });
});
