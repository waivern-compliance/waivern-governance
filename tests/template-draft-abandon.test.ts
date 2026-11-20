/**
 * A template draft is written only when it is first saved, so one that is
 * started and discarded leaves nothing. A saved draft is audited and is never
 * deleted: it can be abandoned, which keeps it as it was and frees the
 * template for a new draft.
 */
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createElement } from 'react';
import { eq, sql } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';

import { NewDraft } from '@/components/templates/NewDraft';
import { db, sql as pg } from '@/db/client';
import { auditEvents, organisations, templateVersions } from '@/db/schema';
import { verifyAuditChain } from '@/lib/audit';
import { draftBasis } from '@/lib/templates/draft-basis';
import type { TemplateDefinition } from '@/lib/templates/schema';
import {
  abandonDraft,
  createDraftFrom,
  createTemplate,
  DraftNotAbandonable,
  publishVersion,
  updateDraft
} from '@/services/templates';

const ACTOR = {
  actorKind: 'system' as const,
  actorUserId: null,
  actorLabel: 'test'
};

function simple(title: string): TemplateDefinition {
  return {
    schema: {
      sections: [
        {
          key: 's',
          title,
          questions: [
            {
              key: 'a',
              label: 'A question',
              type: 'boolean',
              required: true,
              legalRefs: [],
              evidence: 'none'
            }
          ]
        }
      ]
    },
    scoring: { method: 'none' }
  };
}

/** A template published at version 1, with a saved draft at version 2. */
async function withSavedDraft(label: string) {
  const [org] = await db
    .insert(organisations)
    .values({
      name: `Abandon ${label}`,
      slug: `abandon-${label}-${crypto.randomUUID().slice(0, 8)}`
    })
    .returning();
  const { template, version } = await createTemplate({
    organisationId: org.id,
    kind: 'dpia',
    name: 'Draft test',
    definition: simple('Published'),
    actor: ACTOR
  });
  await publishVersion({
    organisationId: org.id,
    versionId: version.id,
    actor: ACTOR
  });
  const draft = await createDraftFrom({
    organisationId: org.id,
    templateId: template.id,
    definition: simple('Set aside'),
    actor: ACTOR
  });
  return { org, template, draft };
}

const versionsOf = (templateId: string) =>
  db
    .select()
    .from(templateVersions)
    .where(eq(templateVersions.templateId, templateId));

after(async () => {
  await pg.end();
});

describe('starting a template draft', () => {
  it('writes nothing until the first save', () => {
    const html = renderToStaticMarkup(
      createElement(NewDraft, { templateId: 'x', definition: simple('P') })
    );
    // Starting is a button that opens the editor, not a form that submits.
    assert.doesNotMatch(html, /<form/);
    assert.match(html, /<button type="button"[^>]*>Start a new draft/);
  });

  it('copies the published version, not an abandoned draft', () => {
    const versions = [
      { version: 3, status: 'abandoned', name: 'abandoned' },
      { version: 2, status: 'published', name: 'published' },
      { version: 1, status: 'retired', name: 'retired' }
    ];
    assert.equal(draftBasis(versions)?.name, 'published');
  });

  it('copies the newest draft not abandoned when nothing is published', () => {
    const versions = [
      { version: 2, status: 'abandoned', name: 'abandoned' },
      { version: 1, status: 'retired', name: 'retired' }
    ];
    assert.equal(draftBasis(versions)?.name, 'retired');
  });
});

describe('abandoning a saved template draft', () => {
  it('keeps the draft as it was, marked abandoned, with the reason audited', async () => {
    const { org, template, draft } = await withSavedDraft('keeps');
    await abandonDraft({
      organisationId: org.id,
      versionId: draft.id,
      reason: 'Started on the wrong template',
      actor: ACTOR
    });

    const [kept] = (await versionsOf(template.id)).filter(
      (v) => v.id === draft.id
    );
    assert.equal(kept.status, 'abandoned');
    assert.equal(kept.publishedAt, null);
    assert.equal(kept.definition.schema.sections[0].title, 'Set aside');

    const [event] = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.subjectId, draft.id))
      .then((rows) =>
        rows.filter((e) => e.action === 'template_version.abandoned')
      );
    assert.deepEqual(event.after, {
      status: 'abandoned',
      version: 2,
      reason: 'Started on the wrong template'
    });
    assert.equal((await verifyAuditChain(org.id)).ok, true);
  });

  it('frees the template for a new draft, numbered after the abandoned one', async () => {
    const { org, template, draft } = await withSavedDraft('frees');
    await abandonDraft({
      organisationId: org.id,
      versionId: draft.id,
      reason: 'Not needed',
      actor: ACTOR
    });
    const next = await createDraftFrom({
      organisationId: org.id,
      templateId: template.id,
      actor: ACTOR
    });
    assert.equal(next.version, 3);
    assert.equal(next.definition.schema.sections[0].title, 'Published');
  });

  it('refuses without a reason', async () => {
    const { org, draft } = await withSavedDraft('reason');
    await assert.rejects(
      abandonDraft({
        organisationId: org.id,
        versionId: draft.id,
        reason: '  ',
        actor: ACTOR
      }),
      DraftNotAbandonable
    );
  });

  it('refuses a version that is not a draft', async () => {
    const { org, template } = await withSavedDraft('published');
    const published = (await versionsOf(template.id)).find(
      (v) => v.status === 'published'
    )!;
    await assert.rejects(
      abandonDraft({
        organisationId: org.id,
        versionId: published.id,
        reason: 'Trying',
        actor: ACTOR
      }),
      /Only a draft can be abandoned/
    );
  });

  it('refuses a draft in another organisation', async () => {
    const { draft } = await withSavedDraft('owner');
    const { org: other } = await withSavedDraft('other');
    await assert.rejects(
      abandonDraft({
        organisationId: other.id,
        versionId: draft.id,
        reason: 'Not mine',
        actor: ACTOR
      })
    );
    const [still] = await db
      .select()
      .from(templateVersions)
      .where(eq(templateVersions.id, draft.id));
    assert.equal(still.status, 'draft');
  });

  it('cannot be edited, published or reopened afterwards', async () => {
    const { org, draft } = await withSavedDraft('frozen');
    await abandonDraft({
      organisationId: org.id,
      versionId: draft.id,
      reason: 'Done with it',
      actor: ACTOR
    });
    await assert.rejects(
      updateDraft({
        organisationId: org.id,
        versionId: draft.id,
        definition: simple('Changed'),
        actor: ACTOR
      }),
      /Only a draft version can be edited/
    );
    await assert.rejects(
      publishVersion({
        organisationId: org.id,
        versionId: draft.id,
        actor: ACTOR
      }),
      /Only a draft version can be published/
    );
    // And at the database, whatever the application does.
    await assert.rejects(
      db.execute(
        sql`update template_version set status = 'draft' where id = ${draft.id}`
      ),
      (err: unknown) =>
        /abandoned and cannot be changed/.test(
          `${(err as Error).message} ${((err as Error).cause as Error)?.message ?? ''}`
        )
    );
  });
});
