import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';

import { db, sql as pg } from '@/db/client';
import {
  auditEvents,
  entities,
  importBatches,
  organisations,
  trials,
  users
} from '@/db/schema';
import {
  besideMapping,
  buildTurn,
  CELL_LIMIT,
  readSuggestion,
  sampleRows
} from '@/lib/import/suggest';
import { saveProvider } from '@/services/assistant';
import { suggestColumns } from '@/services/import-suggestions';
import { loadImport, previewImport, uploadImport } from '@/services/imports';

const ACTOR = {
  actorKind: 'system' as const,
  actorUserId: null,
  actorLabel: 'import-suggestions.test'
};

/** A model that answers with whatever the test told it to. */
let model: Server;
let modelUrl = '';
let sent = '';
let reply = '';

before(async () => {
  model = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      sent = body;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({ content: [{ type: 'text', text: reply }] })
      );
    });
  });
  await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', resolve));
  const address = model.address();
  modelUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/v1/messages`;
});

after(async () => {
  await new Promise<void>((resolve) => model.close(() => resolve()));
  await pg.end();
});

async function anOrg(
  label: string,
  surfaces: Array<'import_mapping' | 'help'> = ['import_mapping']
) {
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
  await saveProvider({
    organisationId: org.id,
    kind: 'anthropic',
    baseUrl: modelUrl,
    model: 'test-model',
    surfaces,
    apiKey: 'not-a-real-key',
    isActive: true,
    actor: ACTOR
  });
  return org;
}

const upload = (
  organisationId: string,
  text: string,
  recordType: 'ai_use_case' | 'data_subject_request' = 'ai_use_case'
) =>
  uploadImport({
    organisationId,
    recordType,
    sourceName: 'Old platform',
    filename: 'file.csv',
    contentType: 'text/csv',
    bytes: new TextEncoder().encode(text),
    actor: ACTOR
  });

const SYSTEMS = [
  'Name,Ref,Field 1,Field 2,Origin,Contact',
  'Chatbot,AI-1,Answer customers,LLM,Third party API,ada@example.com',
  'Scorer,AI-2,Score leads,Predictive,In house,bob@example.com',
  'Router,AI-3,Route tickets,Predictive,In house,cy@example.com',
  'Sorter,AI-4,Sort email,Generative,In house,di@example.com'
].join('\n');

describe('what is sent to the model', () => {
  it('sends no rows for case history, and at most three cut-short rows otherwise', () => {
    const rows = [
      ['a', 'x'.repeat(200)],
      ['b', 'y'],
      ['c', 'z'],
      ['d', 'w']
    ];
    assert.deepEqual(
      sampleRows('data_subject_request', ['Name', 'Notes'], rows),
      []
    );
    const samples = sampleRows('ai_use_case', ['Name', 'Notes'], rows);
    assert.equal(samples.length, 3);
    assert.equal(samples[0][1].length, CELL_LIMIT + 1);
    assert.match(
      buildTurn('data_subject_request', ['Received'], []),
      /No sample rows are given/
    );
  });

  it('sends the header and three rows, with email addresses removed', async () => {
    const org = await anOrg('suggest-sent');
    const batch = await upload(org.id, SYSTEMS);
    reply = '{"fields": {}}';
    await suggestColumns({
      organisationId: org.id,
      batchId: batch.id,
      actor: ACTOR
    });
    assert.match(sent, /Field 1/);
    assert.match(sent, /Router/);
    assert.doesNotMatch(sent, /Sorter/, 'a fourth row is not sent');
    assert.doesNotMatch(sent, /ada@example\.com/);
  });

  it('sends only the header row for a case-history file', async () => {
    const org = await anOrg('suggest-cases');
    const batch = await upload(
      org.id,
      'Ref,Who,Opened\nR-1,Jane Requester,2026-01-02\n',
      'data_subject_request'
    );
    reply = '{"fields": {}}';
    await suggestColumns({
      organisationId: org.id,
      batchId: batch.id,
      actor: ACTOR
    });
    assert.match(sent, /Opened/);
    assert.doesNotMatch(sent, /Jane Requester/);
    assert.doesNotMatch(sent, /2026-01-02/);
  });
});

describe('what of the reply is believed', () => {
  it('drops unknown fields, unknown columns and a column given twice, but lets ratings share', () => {
    const read = readSuggestion(
      '```json\n{"fields": {"name": "Name", "purpose": "name", "nonsense": "Field 1", "description": "Nowhere"}}\n```',
      'ai_use_case',
      ['Name', 'Field 1']
    );
    assert.deepEqual(read, {
      fields: { name: 'Name' },
      notes: null,
      dropped: 3
    });
    const ratings = readSuggestion(
      '{"fields": {"inherentLikelihood": "Rating", "inherentImpact": "Rating"}}',
      'risk',
      ['Rating']
    );
    assert.deepEqual(ratings?.fields, {
      inherentLikelihood: 'Rating',
      inherentImpact: 'Rating'
    });
    assert.equal(readSuggestion('I cannot help.', 'risk', ['Rating']), null);
  });

  it('never overwrites a matched field, and lists where it would differ', () => {
    assert.deepEqual(
      besideMapping(
        { name: 'Name', purpose: 'Field 1' },
        {
          name: 'Name',
          purpose: 'Field 2',
          systemType: 'Field 1',
          provenance: 'Origin'
        }
      ),
      { filled: { provenance: 'Origin' }, differs: { purpose: 'Field 2' } }
    );
  });
});

describe('suggesting a matching', () => {
  it('fills only the empty fields, marks them, and is cleared by a preview', async () => {
    const org = await anOrg('suggest-fills');
    const batch = await upload(org.id, SYSTEMS);
    const before = (await loadImport(batch.id, org.id))!;
    assert.equal(before.mapping.fields.name, 'Name');
    assert.equal(before.mapping.fields.purpose, undefined);

    reply = JSON.stringify({
      fields: {
        name: 'Ref',
        externalRef: 'Ref',
        purpose: 'Field 1',
        systemType: 'Field 2',
        provenance: 'Origin'
      },
      notes: 'Contact looks like an owner email.'
    });
    const suggestion = await suggestColumns({
      organisationId: org.id,
      batchId: batch.id,
      actor: ACTOR
    });
    assert.equal(suggestion.failure, null);
    assert.equal(suggestion.notes, 'Contact looks like an owner email.');

    const loaded = (await loadImport(batch.id, org.id))!;
    assert.equal(loaded.mapping.fields.name, 'Name', 'a name match is kept');
    assert.equal(loaded.mapping.fields.purpose, 'Field 1');
    assert.equal(loaded.mapping.fields.provenance, 'Origin');
    assert.deepEqual(loaded.suggested.differs, { name: 'Ref' });
    assert.ok(loaded.suggested.filled.includes('systemType'));

    assert.deepEqual(
      await previewImport({
        organisationId: org.id,
        batchId: batch.id,
        mapping: loaded.mapping,
        actor: ACTOR
      }),
      { create: 4 }
    );
    const previewed = (await loadImport(batch.id, org.id))!;
    assert.equal(previewed.batch.suggestion, null);
    assert.deepEqual(previewed.suggested.filled, []);
    assert.equal(previewed.mapping.fields.provenance, 'Origin');
  });

  it('records a reply it cannot read as a failure, and changes nothing', async () => {
    const org = await anOrg('suggest-unreadable');
    const batch = await upload(org.id, SYSTEMS);
    reply = 'Sorry, I would rather not.';
    const suggestion = await suggestColumns({
      organisationId: org.id,
      batchId: batch.id,
      actor: ACTOR
    });
    assert.match(suggestion.failure ?? '', /not in a shape that could be read/);
    const loaded = (await loadImport(batch.id, org.id))!;
    assert.deepEqual(loaded.suggested.filled, []);
  });

  it('audits who asked and which model, with nothing from the file', async () => {
    const org = await anOrg('suggest-audit');
    const batch = await upload(org.id, SYSTEMS);
    reply = '{"fields": {"purpose": "Field 1"}}';
    await suggestColumns({
      organisationId: org.id,
      batchId: batch.id,
      actor: ACTOR
    });
    const [event] = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organisationId, org.id),
          eq(auditEvents.action, 'import.mapping_suggested')
        )
      );
    assert.equal(event.actorLabel, ACTOR.actorLabel);
    const after = event.after as Record<string, unknown>;
    assert.equal(after.model, 'test-model');
    assert.equal(after.suggested, 1);
    assert.doesNotMatch(JSON.stringify(after), /Field 1|Chatbot/);
  });

  it('is refused with the surface off, for a trial, and once imported', async () => {
    const off = await anOrg('suggest-off', ['help']);
    const offBatch = await upload(off.id, SYSTEMS);
    await assert.rejects(
      suggestColumns({
        organisationId: off.id,
        batchId: offBatch.id,
        actor: ACTOR
      }),
      /switched off/
    );

    const trial = await anOrg('suggest-trial');
    const trialBatch = await upload(trial.id, SYSTEMS);
    const [user] = await db
      .insert(users)
      .values({ email: `trial-${crypto.randomUUID()}@example.com` })
      .returning();
    await db.insert(trials).values({
      organisationId: trial.id,
      userId: user.id,
      canonicalEmail: user.email,
      endsAt: new Date(Date.now() + 86_400_000),
      fictionalDataAcceptedAt: new Date()
    });
    await assert.rejects(
      suggestColumns({
        organisationId: trial.id,
        batchId: trialBatch.id,
        actor: ACTOR
      }),
      /trial/
    );

    const done = await anOrg('suggest-done');
    const doneBatch = await upload(done.id, SYSTEMS);
    await db
      .update(importBatches)
      .set({ status: 'committed' })
      .where(eq(importBatches.id, doneBatch.id));
    await assert.rejects(
      suggestColumns({
        organisationId: done.id,
        batchId: doneBatch.id,
        actor: ACTOR
      }),
      /no longer being matched/
    );
  });
});
