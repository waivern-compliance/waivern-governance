import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';

import { db, sql as pg } from '@/db/client';
import {
  assessments,
  entities,
  organisations,
  processingActivities,
  risks,
  templates,
  templateVersions
} from '@/db/schema';
import type { RecordType } from '@/lib/import/fields';
import {
  AssessmentNotEditable,
  saveAnswers,
  submitAssessment
} from '@/services/assessments';
import {
  commitImport,
  confirmImportedRecord,
  loadImport,
  previewImport,
  undoImport,
  uploadImport
} from '@/services/imports';

const SYSTEM = {
  actorKind: 'system' as const,
  actorUserId: null,
  actorLabel: 'assessment import test'
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
  const [payroll] = await db
    .insert(processingActivities)
    .values({
      organisationId: org.id,
      entityId: entity.id,
      reference: `ROPA-2026-${crypto.randomUUID().slice(0, 4)}`,
      name: 'Payroll'
    })
    .returning();
  return { org, entity, payroll };
}

/** Upload, preview with the columns as guessed, and import. */
async function imported(
  organisationId: string,
  recordType: RecordType,
  text: string
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
  const { mapping } = (await loadImport(batch.id, organisationId))!;
  const preview = await previewImport({
    organisationId,
    batchId: batch.id,
    mapping,
    actor: SYSTEM
  });
  await commitImport({ organisationId, batchId: batch.id, actor: SYSTEM });
  return {
    batch,
    preview,
    rows: (await loadImport(batch.id, organisationId))!.rows
  };
}

const assessmentsOf = (organisationId: string) =>
  db
    .select()
    .from(assessments)
    .where(eq(assessments.organisationId, organisationId))
    .orderBy(assessments.externalRef);

const FILE = [
  'ID,Title,Type,Status,Processing activity,Decided on,Approved by,Is special category data processed?,Is the processing large scale?',
  'A-1,Payroll DPIA,DPIA,Completed,Payroll,2024-05-01,J. Smith,Yes,No',
  'A-2,New CRM screening,Screening,In progress,,,,No,'
].join('\n');

describe('importing assessments', () => {
  it('lands each on the imported template of its kind, with its answers as asked there, waiting to be confirmed', async () => {
    const w = await world('import-assessments');
    const { preview } = await imported(w.org.id, 'assessment', FILE);
    assert.deepEqual(preview, { create: 2 });

    const [dpia, screening] = await assessmentsOf(w.org.id);
    assert.equal(dpia.status, 'imported');
    assert.equal(dpia.importedOutcome, 'approved');
    assert.match(dpia.reference, /^DPIA-/);
    assert.equal(dpia.subjectType, 'processing_activity');
    assert.equal(dpia.subjectId, w.payroll.id);
    assert.equal(dpia.completedAt?.toISOString().slice(0, 10), '2024-05-01');
    assert.deepEqual(dpia.sourceAnswers, [
      { question: 'Is special category data processed?', answer: 'Yes' },
      { question: 'Is the processing large scale?', answer: 'No' }
    ]);
    assert.deepEqual(dpia.sourceHistory, [
      {
        at: '2024-05-01T00:00:00.000Z',
        what: 'Approved in OneTrust',
        by: 'J. Smith'
      }
    ]);

    // Unfinished there is withdrawn here, as history (decision 4).
    assert.equal(screening.importedOutcome, 'withdrawn');
    assert.equal(screening.sourceHistory?.[0].what, 'Unfinished in OneTrust');

    // On a template of its kind with no questions of its own, never offered.
    const [onTemplate] = await db
      .select({ template: templates, version: templateVersions })
      .from(templateVersions)
      .innerJoin(templates, eq(templates.id, templateVersions.templateId))
      .where(eq(templateVersions.id, dpia.templateVersionId));
    assert.equal(onTemplate.template.kind, 'dpia');
    assert.equal(onTemplate.template.isSystem, true);
    assert.equal(onTemplate.version.status, 'retired');
    // One template per kind, whatever the number imported.
    assert.notEqual(screening.templateVersionId, dpia.templateVersionId);

    // It counts as no outcome until a person confirms it; then as approved.
    await confirmImportedRecord({
      organisationId: w.org.id,
      type: 'assessment',
      id: dpia.id,
      actor: SYSTEM
    });
    const [confirmed] = await db
      .select()
      .from(assessments)
      .where(eq(assessments.id, dpia.id));
    assert.equal(confirmed.status, 'approved');
    assert.ok(confirmed.importConfirmedAt);
  });

  it('refuses answers and submission in the service, not only on the page', async () => {
    const w = await world('import-assessments-readonly');
    await imported(w.org.id, 'assessment', FILE);
    const [dpia] = await assessmentsOf(w.org.id);
    await assert.rejects(
      saveAnswers({
        assessmentId: dpia.id,
        organisationId: w.org.id,
        answers: { imported: 'changed' },
        actor: SYSTEM
      }),
      (e: unknown) =>
        e instanceof AssessmentNotEditable && /read only/.test(e.message)
    );
    await assert.rejects(
      submitAssessment({
        assessmentId: dpia.id,
        organisationId: w.org.id,
        actor: SYSTEM
      }),
      (e: unknown) => e instanceof AssessmentNotEditable
    );
  });

  it('refuses a row naming two subjects, or one not recorded', async () => {
    const w = await world('import-assessments-subjects');
    const { preview, rows } = await imported(
      w.org.id,
      'assessment',
      [
        'ID,Title,Type,Status,Processing activity,AI system',
        'A-1,Two things,DPIA,Completed,Payroll,Chatbot',
        'A-2,Missing,DPIA,Completed,Nothing like this,'
      ].join('\n')
    );
    assert.deepEqual(preview, { refuse: 2 });
    assert.match(rows[0].reason ?? '', /more than one/);
    assert.match(
      rows[1].reason ?? '',
      /No processing activity "Nothing like this"/
    );
  });

  it('links risks that named it, before or after, and undo clears the links it made', async () => {
    const w = await world('import-assessments-risks');
    await imported(
      w.org.id,
      'risk',
      'ID,Title,Description,Likelihood,Impact,Assessment\nR-1,Payroll leak,Sent to the wrong person,2,2,a-1\n'
    );
    const { batch } = await imported(w.org.id, 'assessment', FILE);
    const [dpia] = await assessmentsOf(w.org.id);
    const riskBy = async (ref: string) =>
      (
        await db
          .select()
          .from(risks)
          .where(
            and(eq(risks.organisationId, w.org.id), eq(risks.externalRef, ref))
          )
      )[0];
    assert.equal((await riskBy('R-1')).assessmentId, dpia.id);

    // A risk imported after the assessment is linked as it comes in.
    await imported(
      w.org.id,
      'risk',
      'ID,Title,Description,Likelihood,Impact,Assessment\nR-2,Payroll delay,Paid late,1,1,A-1\n'
    );
    assert.equal((await riskBy('R-2')).assessmentId, dpia.id);

    // R-2 now points at it from outside this import, so undo is refused...
    await assert.rejects(
      undoImport({ organisationId: w.org.id, batchId: batch.id, actor: SYSTEM })
    );
    // ...until that link is gone; the link the import made is cleared with it.
    await db
      .update(risks)
      .set({ assessmentId: null })
      .where(eq(risks.id, (await riskBy('R-2')).id));
    await undoImport({
      organisationId: w.org.id,
      batchId: batch.id,
      actor: SYSTEM
    });
    assert.equal((await riskBy('R-1')).assessmentId, null);
    assert.equal((await assessmentsOf(w.org.id)).length, 0);
  });

  it('updates on a second import, and leaves one that is history here', async () => {
    const w = await world('import-assessments-again');
    await imported(w.org.id, 'assessment', FILE);
    const again = await imported(
      w.org.id,
      'assessment',
      FILE.replace('Payroll DPIA', 'Payroll DPIA 2024')
    );
    assert.deepEqual(again.preview, { update: 2 });
    const [dpia] = await assessmentsOf(w.org.id);
    assert.equal(dpia.title, 'Payroll DPIA 2024');
    assert.equal(dpia.status, 'imported');

    // Superseded here by a reassessment: no longer the import's to change.
    await db
      .update(assessments)
      .set({ status: 'superseded' })
      .where(eq(assessments.id, dpia.id));
    const third = await imported(w.org.id, 'assessment', FILE);
    assert.equal(third.rows[0].action, 'refuse');
    assert.match(
      third.rows[0].reason ?? '',
      /superseded here since it was imported/
    );
  });
});
