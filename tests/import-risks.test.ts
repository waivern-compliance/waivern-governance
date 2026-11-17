import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { and, eq, gte } from 'drizzle-orm';

import { db, sql as pg } from '@/db/client';
import {
  auditEvents,
  entities,
  informationAssetRisks,
  informationAssets,
  organisations,
  processingActivities,
  recordLinks,
  riskAcceptances,
  risks
} from '@/db/schema';
import type { ImportMapping } from '@/lib/import/types';
import { createUseCase } from '@/services/ai-register';
import {
  commitImport,
  loadImport,
  previewImport,
  undoImport,
  uploadImport,
  valuesToTranslate
} from '@/services/imports';
import { loadRisk } from '@/services/risks';
import { createSupplier } from '@/services/third-party';

const SYSTEM = {
  actorKind: 'system' as const,
  actorUserId: null,
  actorLabel: 'risk import test'
};

after(() => pg.end());

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
  return { org, entity };
}

async function upload(organisationId: string, text: string) {
  return uploadImport({
    organisationId,
    recordType: 'risk',
    sourceName: 'OneTrust',
    filename: 'risks.csv',
    contentType: 'text/csv',
    bytes: new TextEncoder().encode(text),
    actor: SYSTEM
  });
}

async function preview(
  organisationId: string,
  batchId: string,
  values?: ImportMapping['values'],
  fields?: Record<string, string>
) {
  const offered = (await loadImport(batchId, organisationId))!.mapping;
  const mapping: ImportMapping = {
    ...offered,
    fields: { ...offered.fields, ...fields },
    ...(values ? { values } : {})
  };
  const counts = await previewImport({
    organisationId,
    batchId,
    mapping,
    actor: SYSTEM
  });
  return { counts, mapping };
}

const risksOf = (organisationId: string) =>
  db
    .select()
    .from(risks)
    .where(eq(risks.organisationId, organisationId))
    .orderBy(risks.externalRef);

describe('importing risks', () => {
  it("reads ratings on the organisation's scale, and asks what any other value means", async () => {
    const { org } = await world('import-risks-scale');
    const batch = await upload(
      org.id,
      [
        'ID,Title,Description,Likelihood,Impact,Residual likelihood,Residual impact,Status,Closed on',
        'R-1,Payroll leak,Payroll file sent to the wrong person,3,Severe,2,2,Open,',
        'R-2,Vendor breach,A supplier is breached,High,Medium,,,Treating,',
        'R-3,Half rated,Only one residual,2,2,1,,,',
        'R-4,Old risk,Closed without a date,1,1,,,Closed,'
      ].join('\n')
    );
    const first = await preview(org.id, batch.id);
    assert.deepEqual(first.counts, { create: 1, refuse: 3 });
    const rows = (await loadImport(batch.id, org.id))!.rows;
    assert.match(
      rows[1].reason ?? '',
      /Likelihood "High" is not on the four by four scale/
    );
    assert.match(rows[2].reason ?? '', /both its likelihood and its impact/);
    assert.match(rows[3].reason ?? '', /closed risk needs the date/);

    // The values each rating column holds, offered for translation.
    const offered = await valuesToTranslate(org.id, batch.id);
    assert.equal(offered.scale, '4x4');
    assert.deepEqual(
      offered.fields.find((f) => f.key === 'inherentLikelihood')?.values,
      ['1', '2', '3', 'High']
    );

    const second = await preview(org.id, batch.id, {
      inherentLikelihood: { high: '4' },
      inherentImpact: { medium: '2' }
    });
    assert.deepEqual(second.counts, { create: 2, refuse: 2 });
    await commitImport({
      organisationId: org.id,
      batchId: batch.id,
      actor: SYSTEM
    });
    const [leak, vendor] = await risksOf(org.id);
    assert.equal(leak.inherentLikelihood, 3);
    assert.equal(leak.inherentImpact, 4);
    assert.equal(leak.inherentScore, 12);
    assert.equal(leak.inherentTier, 'critical');
    assert.equal(leak.residualScore, 4);
    assert.equal(leak.status, 'identified');
    assert.equal(leak.source, 'integration');
    assert.equal(leak.importConfirmedAt, null);
    assert.match(leak.reference, /^RISK-\d{4}-/);
    assert.equal(vendor.inherentScore, 8);
    assert.equal(vendor.status, 'treating');
  });

  it('reads one rating column as both likelihood and impact', async () => {
    const { org } = await world('import-risks-one-rating');
    const batch = await upload(
      org.id,
      'ID,Title,Description,Rating\nR-1,Leak,A leak,Low\nR-2,Breach,A breach,High\n'
    );
    const { counts } = await preview(
      org.id,
      batch.id,
      {
        inherentLikelihood: { low: '1', high: '3' },
        inherentImpact: { low: '2', high: '4' }
      },
      { inherentLikelihood: 'Rating', inherentImpact: 'Rating' }
    );
    assert.deepEqual(counts, { create: 2 });
    await commitImport({
      organisationId: org.id,
      batchId: batch.id,
      actor: SYSTEM
    });
    const [low, high] = await risksOf(org.id);
    assert.equal(low.inherentScore, 2);
    assert.equal(high.inherentScore, 12);
    // What the source said is kept beside the translation.
    assert.equal(high.legacy?.['Likelihood as rated there'], 'High');
    assert.equal(high.legacy?.['Impact as rated there'], 'High');
  });

  it('keeps an acceptance as the source history, and the risk waits to be accepted here', async () => {
    const { org } = await world('import-risks-accepted');
    const batch = await upload(
      org.id,
      [
        'ID,Title,Description,Likelihood,Impact,Status,Accepted by,Accepted on,Acceptance expiry,Acceptance rationale',
        'R-1,Legacy CRM,Old CRM still in use,2,2,Accepted,J. Smith,2024-03-03,2025-03-03,Replacement planned'
      ].join('\n')
    );
    await preview(org.id, batch.id);
    const started = new Date();
    await commitImport({
      organisationId: org.id,
      batchId: batch.id,
      actor: SYSTEM
    });
    const [risk] = await risksOf(org.id);
    assert.equal(risk.status, 'identified');
    assert.deepEqual(risk.sourceHistory, [
      {
        at: '2024-03-03T00:00:00.000Z',
        what: 'Accepted in OneTrust',
        by: 'J. Smith',
        detail: 'Replacement planned Accepted until 2025-03-03.'
      }
    ]);
    assert.equal(
      (
        await db
          .select()
          .from(riskAcceptances)
          .where(eq(riskAcceptances.riskId, risk.id))
      ).length,
      0
    );
    // The audit chain says only that it was imported, now, by whoever did it.
    const events = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.subjectId, risk.id));
    assert.deepEqual(
      events.map((e) => e.action),
      ['risk.created']
    );
    assert.ok(events[0].at.getTime() >= started.getTime() - 1000);
  });

  it('links what it concerns, refuses what is not recorded, and undo takes the links back out', async () => {
    const { org, entity } = await world('import-risks-links');
    const [payroll] = await db
      .insert(processingActivities)
      .values({
        organisationId: org.id,
        entityId: entity.id,
        reference: 'ROPA-2026-0001',
        name: 'Payroll'
      })
      .returning();
    const acme = await createSupplier({
      organisationId: org.id,
      name: 'Acme Payroll Ltd',
      categories: [],
      actor: SYSTEM
    });
    const system = await createUseCase({
      organisationId: org.id,
      entityId: entity.id,
      name: 'Payroll anomaly detector',
      purpose: 'Flags unusual payments for a person to check.',
      systemType: 'predictive',
      provenance: 'third_party_api',
      actor: SYSTEM
    });
    const [asset] = await db
      .insert(informationAssets)
      .values({
        organisationId: org.id,
        entityId: entity.id,
        reference: 'IA-2026-0001',
        name: 'Payroll system',
        assetType: 'system'
      })
      .returning();
    const batch = await upload(
      org.id,
      [
        'ID,Title,Description,Likelihood,Impact,Processing activities,Suppliers,AI systems,Assets',
        'R-1,Payroll leak,A leak,2,3,ROPA-2026-0001,Acme Payroll Ltd,Payroll anomaly detector,Payroll system',
        'R-2,Unknown,Names nothing recorded,2,3,Recruitment,,,'
      ].join('\n')
    );
    const { counts } = await preview(org.id, batch.id);
    assert.deepEqual(counts, { create: 1, refuse: 1 });
    await commitImport({
      organisationId: org.id,
      batchId: batch.id,
      actor: SYSTEM
    });
    const [risk] = await risksOf(org.id);
    const links = await db
      .select()
      .from(recordLinks)
      .where(
        and(
          eq(recordLinks.fromId, risk.id),
          eq(recordLinks.relation, 'concerns')
        )
      );
    assert.deepEqual(
      links.map((l) => l.toId).sort(),
      [payroll.id, acme.id, system.id].sort()
    );
    assert.equal(
      (
        await db
          .select()
          .from(informationAssetRisks)
          .where(eq(informationAssetRisks.assetId, asset.id))
      ).length,
      1
    );
    const loaded = (await loadRisk(risk.id, org.id))!;
    assert.deepEqual(loaded.concerns.map((c) => c.kind).sort(), [
      'AI system',
      'Processing activity',
      'Supplier'
    ]);

    await undoImport({
      organisationId: org.id,
      batchId: batch.id,
      actor: SYSTEM
    });
    assert.equal((await risksOf(org.id)).length, 0);
    assert.equal(
      (
        await db
          .select()
          .from(recordLinks)
          .where(eq(recordLinks.organisationId, org.id))
      ).length,
      0
    );
  });

  it('updates on re-import and keeps what a short file leaves out', async () => {
    const { org } = await world('import-risks-again');
    const first = await upload(
      org.id,
      'ID,Title,Description,Likelihood,Impact,Next review\nR-1,Leak,A leak,2,2,2027-01-01\n'
    );
    await preview(org.id, first.id);
    await commitImport({
      organisationId: org.id,
      batchId: first.id,
      actor: SYSTEM
    });
    const again = await upload(
      org.id,
      'ID,Title,Description,Likelihood,Impact,Next review\nr-1,Leak,A worse leak,3,3,\n'
    );
    const { counts } = await preview(org.id, again.id);
    assert.deepEqual(counts, { update: 1 });
    const since = new Date();
    await commitImport({
      organisationId: org.id,
      batchId: again.id,
      actor: SYSTEM
    });
    const [risk] = await risksOf(org.id);
    assert.equal(risk.description, 'A worse leak');
    assert.equal(risk.inherentScore, 9);
    assert.equal(risk.nextReviewAt?.toISOString().slice(0, 10), '2027-01-01');
    const [updated] = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.subjectId, risk.id),
          eq(auditEvents.action, 'risk.updated'),
          gte(auditEvents.at, new Date(since.getTime() - 1000))
        )
      );
    assert.ok(updated);
  });

  it('keeps a status set here, and the history, when a short file says nothing of them', async () => {
    const { org } = await world('import-risks-keep-status');
    const first = await upload(
      org.id,
      'ID,Title,Description,Likelihood,Impact,Status,Accepted by\nR-1,Leak,A leak,2,2,Accepted,J. Smith\nR-2,Breach,A breach,2,2,Open,\n'
    );
    await preview(org.id, first.id);
    await commitImport({
      organisationId: org.id,
      batchId: first.id,
      actor: SYSTEM
    });
    const [leak, breach] = await risksOf(org.id);
    await db
      .update(risks)
      .set({ status: 'treating' })
      .where(eq(risks.id, breach.id));

    const again = await upload(
      org.id,
      'ID,Title,Description,Likelihood,Impact\nR-1,Leak,A leak still,2,2\nR-2,Breach,A breach still,2,2\n'
    );
    await preview(org.id, again.id, undefined, {
      status: '',
      acceptedBy: ''
    });
    await commitImport({
      organisationId: org.id,
      batchId: again.id,
      actor: SYSTEM
    });
    const [leakAfter, breachAfter] = await risksOf(org.id);
    assert.equal(breachAfter.status, 'treating');
    assert.equal(leakAfter.status, leak.status);
    assert.deepEqual(leakAfter.sourceHistory, leak.sourceHistory);
  });

  it('asks again for a translation saved on another scale', async () => {
    const { org } = await world('import-risks-rescaled');
    const batch = await upload(
      org.id,
      'ID,Title,Description,Likelihood,Impact\nR-1,Leak,A leak,Very high,2\n'
    );
    const { counts } = await preview(org.id, batch.id, {
      inherentLikelihood: { 'very high': '5' }
    });
    assert.deepEqual(counts, { refuse: 1 });
    assert.match(
      (await loadImport(batch.id, org.id))!.rows[0].reason ?? '',
      /translated as 5, which is not on the four by four scale/
    );
  });
});
