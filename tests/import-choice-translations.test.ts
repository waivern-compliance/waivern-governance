import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';

import { db, sql as pg } from '@/db/client';
import { aiUseCases, entities, organisations } from '@/db/schema';
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

const upload = (organisationId: string, text: string) =>
  uploadImport({
    organisationId,
    recordType: 'ai_use_case',
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
      /"Statistical model" is not a type of system Govern knows\. Say what it means on the matching step/
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
    assert.match(rows[3].reason ?? '', /"Quantum" is not a type of system/);

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
});
