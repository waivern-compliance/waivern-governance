import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';

import { db, sql as pg, withOrganisation } from '@/db/client';
import {
  documents,
  entities,
  memberships,
  organisations,
  policies,
  policyActivities,
  policyDocuments,
  policyVersions,
  processingActivities,
  users
} from '@/db/schema';
import { policyKeyFrom } from '@/lib/dpa2018/policy-keys';
import type { RecordType } from '@/lib/import/fields';
import {
  addImportFiles,
  commitImport,
  confirmImportedRecord,
  loadImport,
  previewImport,
  undoImport,
  uploadImport
} from '@/services/imports';
import {
  draftVersion,
  policiesDueForReview,
  reviewOverdue
} from '@/services/policies';
import { policyCoverage } from '@/services/policy-documents';

const SYSTEM = {
  actorKind: 'system' as const,
  actorUserId: null,
  actorLabel: 'policy import test'
};

after(() => pg.end());

const PDF = (text: string) =>
  new TextEncoder().encode(`%PDF-1.4\n% ${text}\n%%EOF\n`);

async function world(label: string) {
  const [org] = await db
    .insert(organisations)
    .values({
      name: label,
      slug: `${label}-${crypto.randomUUID().slice(0, 8)}`
    })
    .returning();
  const [main] = await db
    .insert(entities)
    .values({ organisationId: org.id, name: 'Main', isDefault: true })
    .returning();
  const [other] = await db
    .insert(entities)
    .values({ organisationId: org.id, name: 'Subsidiary Ltd' })
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
      entityId: main.id,
      reference: `ROPA-2026-${crypto.randomUUID().slice(0, 4)}`,
      name: 'Payroll'
    })
    .returning();
  return { org, main, other, person, payroll };
}

/** Upload, add any files, preview with the columns as guessed, and import. */
async function imported(
  organisationId: string,
  recordType: RecordType,
  text: string,
  files: Array<{ filename: string; bytes: Uint8Array }> = [],
  /** Columns matched by hand, as a person does when a new one appears. */
  fields: Record<string, string> = {}
) {
  const batch = await uploadImport({
    organisationId,
    recordType,
    sourceName: 'OneTrust',
    filename: `${recordType}.csv`,
    contentType: 'text/csv',
    bytes: new TextEncoder().encode(text),
    actor: SYSTEM
  });
  if (files.length)
    await addImportFiles({
      organisationId,
      batchId: batch.id,
      files: files.map((f) => ({ ...f, contentType: '' })),
      actor: SYSTEM
    });
  const { mapping } = (await loadImport(batch.id, organisationId))!;
  const preview = await previewImport({
    organisationId,
    batchId: batch.id,
    mapping: { ...mapping, fields: { ...mapping.fields, ...fields } },
    actor: SYSTEM
  });
  await commitImport({ organisationId, batchId: batch.id, actor: SYSTEM });
  return {
    batch,
    preview,
    rows: (await loadImport(batch.id, organisationId))!.rows
  };
}

const byRef = <T extends { externalRef: string | null }>(
  rows: T[],
  ref: string
) => rows.find((r) => r.externalRef === ref)!;

describe('reading a condition as another platform names it', () => {
  it('reads paragraphs, keys and names, and guesses nothing else', () => {
    assert.equal(policyKeyFrom('para 1'), 'para1');
    assert.equal(policyKeyFrom('Schedule 1, paragraph 18'), 'para18');
    assert.equal(policyKeyFrom('Sch 8 para 4'), 'sch8_p4');
    assert.equal(policyKeyFrom('Part 3 consent'), 'part3_consent');
    assert.equal(
      policyKeyFrom('Employment, social security and social protection'),
      'para1'
    );
    assert.equal(policyKeyFrom('para 99'), null);
    assert.equal(policyKeyFrom('Something else'), null);
  });
});

describe('importing appropriate policy documents', () => {
  it('reads conditions and entity, attaches the file, and covers nothing until confirmed', async () => {
    const w = await world('import-apd');
    const { preview, rows } = await imported(
      w.org.id,
      'policy_document',
      [
        'ID,Title,Version,Legal entity,Owner,Conditions,Last reviewed,File',
        `APD-1,Special category policy,2.0,,${w.person.email},para 1; Sch 8 para 4,2025-03-01,apd.pdf`,
        'APD-2,Subsidiary policy,,Subsidiary Ltd,,Part 3 consent,,',
        'APD-3,Unknown entity,,Nowhere Ltd,,para 1,,',
        'APD-4,Odd condition,,,,para 99,,'
      ].join('\n'),
      [{ filename: 'apd.pdf', bytes: PDF('appropriate policy document') }]
    );
    assert.deepEqual(preview, { create: 2, refuse: 2 });
    assert.match(rows[2].reason ?? '', /No legal entity called "Nowhere Ltd"/);
    assert.match(
      rows[3].reason ?? '',
      /"para 99" is not a Schedule 1 condition/
    );

    const docs = await db
      .select()
      .from(policyDocuments)
      .where(eq(policyDocuments.organisationId, w.org.id));
    const special = byRef(docs, 'APD-1');
    assert.equal(special.entityId, null);
    assert.equal(special.ownerId, w.person.id);
    assert.deepEqual(special.conditions, ['para1', 'sch8_p4']);
    assert.equal(special.version, '2.0');
    assert.equal(byRef(docs, 'APD-2').entityId, w.other.id);

    const [file] = await db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.subjectType, 'policy_document'),
          eq(documents.subjectId, special.id)
        )
      );
    assert.equal(file.filename, 'apd.pdf');

    // What another platform said a document covers is not relied on yet.
    const coverage = () =>
      withOrganisation(w.org.id, () => policyCoverage(w.org.id));
    assert.equal((await coverage()).length, 0);
    await confirmImportedRecord({
      organisationId: w.org.id,
      type: 'policy_document',
      id: special.id,
      actor: SYSTEM
    });
    assert.deepEqual(await coverage(), [
      { entityId: null, conditions: ['para1', 'sch8_p4'] }
    ]);
  });
});

describe('importing appropriate policy documents again', () => {
  it('updates one imported before, and keeps whom it is for', async () => {
    const w = await world('import-apd-again');
    await imported(
      w.org.id,
      'policy_document',
      'ID,Title,Conditions\nAPD-1,Special category policy,para 1\n'
    );
    const again = await imported(
      w.org.id,
      'policy_document',
      'ID,Title,Conditions\napd-1,Special category data policy,para 1; para 6\n'
    );
    assert.deepEqual(again.preview, { update: 1 });
    const [doc] = await db
      .select()
      .from(policyDocuments)
      .where(eq(policyDocuments.organisationId, w.org.id));
    assert.equal(doc.title, 'Special category data policy');
    assert.deepEqual(doc.conditions, ['para1', 'para6']);
    assert.equal(doc.importConfirmedAt, null);

    const moved = await imported(
      w.org.id,
      'policy_document',
      'ID,Title,Legal entity\nAPD-1,Special category data policy,Subsidiary Ltd\n',
      [],
      { entity: 'Legal entity' }
    );
    assert.deepEqual(moved.preview, { refuse: 1 });
    assert.match(
      moved.rows[0].reason ?? '',
      /Imported before for every entity, and this row says Subsidiary Ltd\. Change whom it is for on its page/
    );
  });
});

describe('importing policies', () => {
  it('brings one in force with no version approved here, its approval kept as history', async () => {
    const w = await world('import-policy');
    const { preview, rows } = await imported(
      w.org.id,
      'policy',
      [
        'ID,Title,Summary,Status,Version,Approved by,Approved on,Approval reference,Review every,Processing activities,Withdrawn on',
        'P-1,Information security,How we keep data safe,Active,3.1,Board,2024-01-15,Board minute 12,12,Payroll,',
        'P-2,Acceptable use,,Draft,,,,,,,',
        'P-3,Old retention policy,,Retired,,,,,,,',
        'P-4,Ghost policy,,Active,,,,,,Nothing called this,'
      ].join('\n')
    );
    assert.deepEqual(preview, { create: 2, refuse: 2 });
    assert.match(rows[2].reason ?? '', /withdrawn policy needs the date/);
    assert.match(
      rows[3].reason ?? '',
      /No processing activity "Nothing called this"/
    );

    const all = await db
      .select()
      .from(policies)
      .where(eq(policies.organisationId, w.org.id));
    const security = byRef(all, 'P-1');
    assert.equal(security.status, 'in_force');
    assert.match(security.reference, /^POL-/);
    assert.equal(security.entityId, null);
    assert.equal(security.importConfirmedAt, null);
    // A year from its approval there, as approving here would set it.
    assert.equal(
      security.nextReviewAt?.toISOString().slice(0, 10),
      '2025-01-15'
    );
    assert.deepEqual(security.sourceHistory, [
      {
        at: '2024-01-15T00:00:00.000Z',
        what: 'Version 3.1 approved in OneTrust',
        by: 'Board',
        detail: 'Board minute 12'
      }
    ]);
    assert.equal(security.legacy?.['Version there'], '3.1');
    assert.equal(
      (
        await db
          .select()
          .from(policyVersions)
          .where(eq(policyVersions.policyId, security.id))
      ).length,
      0
    );
    assert.equal(byRef(all, 'P-2').status, 'draft');
    const [link] = await db
      .select()
      .from(policyActivities)
      .where(eq(policyActivities.policyId, security.id));
    assert.equal(link.activityId, w.payroll.id);

    // Its review, long past, waits until a person has confirmed it, and it
    // is not shown as overdue meanwhile.
    assert.equal((await policiesDueForReview(w.org.id)).length, 0);
    assert.equal(reviewOverdue(security), false);
    await confirmImportedRecord({
      organisationId: w.org.id,
      type: 'policy',
      id: security.id,
      actor: SYSTEM
    });
    assert.equal((await policiesDueForReview(w.org.id)).length, 1);
  });

  it('updates on a second import, keeps whom it is for, and leaves the cycle once a version is drafted here', async () => {
    const w = await world('import-policy-again');
    await imported(
      w.org.id,
      'policy',
      'ID,Title,Status,Next review\nP-1,Information security,Draft,\n'
    );
    const [first] = await db
      .select()
      .from(policies)
      .where(eq(policies.organisationId, w.org.id));
    await draftVersion({
      organisationId: w.org.id,
      policyId: first.id,
      label: '4.0',
      actor: SYSTEM
    });

    const again = await imported(
      w.org.id,
      'policy',
      [
        'ID,Title,Status,Next review,Legal entity',
        'p-1,Information security policy,Active,2030-01-01,',
        'P-2,Moved,Draft,,Subsidiary Ltd'
      ].join('\n'),
      [],
      { entity: 'Legal entity', status: 'Status', nextReviewAt: 'Next review' }
    );
    assert.deepEqual(again.preview, { update: 1, create: 1 });
    const [now] = await db
      .select()
      .from(policies)
      .where(eq(policies.id, first.id));
    assert.equal(now.title, 'Information security policy');
    assert.equal(now.status, 'draft');
    assert.equal(now.nextReviewAt, null);

    const moved = await imported(
      w.org.id,
      'policy',
      'ID,Title,Legal entity\nP-1,Information security policy,Subsidiary Ltd\n',
      [],
      { entity: 'Legal entity' }
    );
    assert.deepEqual(moved.preview, { refuse: 1 });
    assert.match(
      moved.rows[0].reason ?? '',
      /Imported before for every entity, and this row says Subsidiary Ltd/
    );
  });

  it('is undone with the links and files it made', async () => {
    const w = await world('import-policy-undo');
    const { batch } = await imported(
      w.org.id,
      'policy',
      'ID,Title,Processing activities,File\nP-1,Information security,Payroll,isp.pdf\n',
      [{ filename: 'isp.pdf', bytes: PDF('information security policy') }]
    );
    const [made] = await db
      .select()
      .from(policies)
      .where(eq(policies.organisationId, w.org.id));
    await undoImport({
      organisationId: w.org.id,
      batchId: batch.id,
      actor: SYSTEM
    });
    assert.equal(
      (
        await db
          .select()
          .from(policies)
          .where(eq(policies.organisationId, w.org.id))
      ).length,
      0
    );
    assert.equal(
      (
        await db
          .select()
          .from(documents)
          .where(
            and(
              eq(documents.subjectType, 'policy'),
              eq(documents.subjectId, made.id)
            )
          )
      ).length,
      0
    );
    assert.equal(
      (
        await db
          .select()
          .from(policyActivities)
          .where(eq(policyActivities.activityId, w.payroll.id))
      ).length,
      0
    );
  });

  it('brings a withdrawn policy back in force cleanly, and counts its review from its approval when the file gives no status', async () => {
    const w = await world('import-policy-reinstated');
    await imported(
      w.org.id,
      'policy',
      'ID,Title,Status,Withdrawn on,Why it was withdrawn\nP-1,Retention,Withdrawn,2024-01-01,Replaced\nP-2,Clear desk,Active,,\n'
    );
    await imported(
      w.org.id,
      'policy',
      'ID,Title,Status,Withdrawn on,Why it was withdrawn\nP-1,Retention,Active,,\n'
    );
    const all = await db
      .select()
      .from(policies)
      .where(eq(policies.organisationId, w.org.id));
    const retention = byRef(all, 'P-1');
    assert.equal(retention.status, 'in_force');
    assert.equal(retention.withdrawnAt, null);
    assert.equal(retention.withdrawnReason, null);

    // No status column: the policy is in force already, so its approval date
    // there sets its next review.
    await imported(
      w.org.id,
      'policy',
      'ID,Title,Approved on\nP-2,Clear desk,2025-06-01\n',
      [],
      { approvedAt: 'Approved on' }
    );
    const [desk] = await db
      .select()
      .from(policies)
      .where(eq(policies.id, byRef(all, 'P-2').id));
    assert.equal(desk.status, 'in_force');
    assert.equal(desk.nextReviewAt?.toISOString().slice(0, 10), '2026-06-01');
  });
});
