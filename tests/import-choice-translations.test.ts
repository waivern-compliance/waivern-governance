import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';

import { db, sql as pg } from '@/db/client';
import { aiUseCases, entities, organisations, risks } from '@/db/schema';
import type { ImportMapping } from '@/lib/import/types';
import {
  commitImport,
  loadImport,
  previewImport,
  uploadImport,
  valuesToTranslate
} from '@/services/imports';

const SYSTEM = {
  actorKind: 'system' as const,
  actorUserId: null,
  actorLabel: 'choice translation test'
};

after(() => pg.end());

async function anOrg(label: string) {
  const [org] = await db
    .insert(organisations)
    .values({
      name: label,
      slug: `${label}-${crypto.randomUUID().slice(0, 8)}`
    })
    .returning();
  await db
    .insert(entities)
    .values({ organisationId: org.id, name: 'Main', isDefault: true });
  return org;
}

const upload = (
  organisationId: string,
  text: string,
  recordType: 'ai_use_case' | 'risk' = 'ai_use_case'
) =>
  uploadImport({
    organisationId,
    recordType,
    sourceName: 'Old platform',
    filename: 'systems.csv',
    contentType: 'text/csv',
    bytes: new TextEncoder().encode(text),
    actor: SYSTEM
  });

async function preview(
  organisationId: string,
  batchId: string,
  values?: ImportMapping['values']
) {
  const offered = (await loadImport(batchId, organisationId))!.mapping;
  return previewImport({
    organisationId,
    batchId,
    mapping: { ...offered, ...(values ? { values } : {}) },
    actor: SYSTEM
  });
}

const FILE = [
  'ID,Name,Purpose,Type,Provenance',
  'AI-1,Chatbot,Answer customers,LLM,Vendor SaaS',
  'AI-2,Scorer,Score leads,Statistical model,In house',
  'AI-3,Router,Route tickets,Statistical model,Vendor SaaS',
  'AI-4,Oddity,Unknown,Quantum,In house'
].join('\n');

describe("translating a platform's own words for a choice", () => {
  it('lists only the values Govern does not recognise, and refuses rows using them until said', async () => {
    const org = await anOrg('import-choice-list');
    const batch = await upload(org.id, FILE);
    assert.deepEqual(await preview(org.id, batch.id), { refuse: 4 });
    const { rows } = (await loadImport(batch.id, org.id))!;
    assert.match(
      rows[1].reason ?? '',
      /Type of system: "Statistical model" is not one Govern knows\. Say what it means on the matching step/
    );

    const offered = await valuesToTranslate(org.id, batch.id);
    assert.deepEqual(
      offered.fields.find((f) => f.key === 'systemType')?.values,
      ['Quantum', 'Statistical model']
    );
    assert.deepEqual(
      offered.fields.find((f) => f.key === 'provenance')?.values,
      ['Vendor SaaS']
    );
  });

  it('reads a value as what a person said it is, and leaves an unsaid one refused', async () => {
    const org = await anOrg('import-choice-said');
    const batch = await upload(org.id, FILE);
    await preview(org.id, batch.id);
    assert.deepEqual(
      await preview(org.id, batch.id, {
        systemType: { 'statistical model': 'predictive' },
        provenance: { 'vendor saas': 'embedded_vendor' }
      }),
      { create: 3, refuse: 1 }
    );
    const { rows } = (await loadImport(batch.id, org.id))!;
    assert.match(
      rows[3].reason ?? '',
      /Type of system: "Quantum" is not one Govern knows/
    );

    await commitImport({
      organisationId: org.id,
      batchId: batch.id,
      actor: SYSTEM
    });
    const systems = await db
      .select()
      .from(aiUseCases)
      .where(eq(aiUseCases.organisationId, org.id))
      .orderBy(aiUseCases.name);
    assert.deepEqual(
      systems.map((s) => [s.name, s.systemType, s.provenance]),
      [
        ['Chatbot', 'generative', 'embedded_vendor'],
        ['Router', 'predictive', 'embedded_vendor'],
        ['Scorer', 'predictive', 'built_in_house']
      ]
    );
  });

  it("saves what was said for the platform, and drops what is not one of the field's values", async () => {
    const org = await anOrg('import-choice-saved');
    const first = await upload(org.id, FILE);
    await preview(org.id, first.id, {
      systemType: { 'statistical model': 'predictive', quantum: 'magic' },
      provenance: { 'vendor saas': 'embedded_vendor' }
    });
    const saved = (await loadImport(first.id, org.id))!.batch.mapping;
    assert.deepEqual(saved?.values, {
      systemType: { 'statistical model': 'predictive' },
      provenance: { 'vendor saas': 'embedded_vendor' }
    });

    // The next file from the same platform is read the same way at once.
    const second = await upload(
      org.id,
      'ID,Name,Purpose,Type,Provenance\nAI-9,Triage,Sort email,Statistical model,Vendor SaaS\n'
    );
    const offered = (await loadImport(second.id, org.id))!.mapping;
    assert.deepEqual(offered.values, saved?.values);
    assert.deepEqual(await preview(org.id, second.id), { create: 1 });
  });

  it('reads a value Govern recognises as it is, whatever was said for it before', async () => {
    const org = await anOrg('import-choice-known-first');
    const batch = await upload(org.id, FILE);
    assert.deepEqual(
      await preview(org.id, batch.id, {
        systemType: { llm: 'agentic', 'statistical model': 'predictive' },
        provenance: { 'vendor saas': 'embedded_vendor' }
      }),
      { create: 3, refuse: 1 }
    );
    await commitImport({
      organisationId: org.id,
      batchId: batch.id,
      actor: SYSTEM
    });
    const [chatbot] = await db
      .select()
      .from(aiUseCases)
      .where(eq(aiUseCases.organisationId, org.id))
      .orderBy(aiUseCases.name);
    assert.equal(chatbot.systemType, 'generative');
  });

  it('lists more values than fit at once a round at a time', async () => {
    const org = await anOrg('import-choice-rounds');
    const lines = Array.from(
      { length: 45 },
      (_, i) => `AI-${i},System ${i},Purpose,LLM,Source ${i}`
    );
    const batch = await upload(
      org.id,
      ['ID,Name,Purpose,Type,Provenance', ...lines].join('\n')
    );
    await preview(org.id, batch.id);
    const first = await valuesToTranslate(org.id, batch.id);
    const listed = first.fields.find((f) => f.key === 'provenance')!.values;
    assert.equal(listed.length, 40);
    assert.equal(first.scale, null);
    assert.deepEqual(
      (await loadImport(batch.id, org.id))!.batch.previewNotes?.valuesBeyond,
      ['provenance']
    );

    await preview(org.id, batch.id, {
      provenance: Object.fromEntries(
        listed.map((v) => [v.toLowerCase(), 'built_in_house'])
      )
    });
    const second = await valuesToTranslate(org.id, batch.id);
    assert.equal(
      second.fields.find((f) => f.key === 'provenance')!.values.length,
      45
    );
    assert.equal(
      (await loadImport(batch.id, org.id))!.batch.previewNotes,
      null
    );
  });

  it("keeps a risk's rating and status translations side by side", async () => {
    const org = await anOrg('import-choice-risk');
    const batch = await upload(
      org.id,
      'ID,Title,Description,Likelihood,Impact,Status\nR-1,Leak,A leak,High,2,Under review\n',
      'risk'
    );
    assert.deepEqual(await preview(org.id, batch.id), { refuse: 1 });
    const offered = await valuesToTranslate(org.id, batch.id);
    assert.equal(offered.scale, '4x4');
    assert.deepEqual(offered.fields.find((f) => f.key === 'status')?.values, [
      'Under review'
    ]);

    const values = {
      inherentLikelihood: { high: '4' },
      status: { 'under review': 'treating' }
    };
    assert.deepEqual(await preview(org.id, batch.id, values), { create: 1 });
    assert.deepEqual(
      (await loadImport(batch.id, org.id))!.batch.mapping?.values,
      values
    );
    await commitImport({
      organisationId: org.id,
      batchId: batch.id,
      actor: SYSTEM
    });
    const [risk] = await db
      .select()
      .from(risks)
      .where(eq(risks.organisationId, org.id));
    assert.equal(risk.inherentLikelihood, 4);
    assert.equal(risk.status, 'treating');
  });
});
