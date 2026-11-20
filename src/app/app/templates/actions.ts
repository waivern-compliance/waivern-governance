'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { refusable, type EditResult } from '@/lib/edit-result';
import { kindsFor } from '@/lib/rbac';
import { requireCapability } from '@/lib/session';
import { readDraft } from '@/lib/templates/read-draft';
import { templateDefinition } from '@/lib/templates/schema';
import { validateTemplate } from '@/lib/templates/validate';
import {
  abandonDraft,
  createDraftFrom,
  createTemplate,
  DraftAlreadyOpen,
  installShippedTemplates,
  OutsideYourKinds,
  publishVersion,
  updateDraft,
  updateShippedTemplates,
  type TemplateKind
} from '@/services/templates';

/** A new template starts with one section and one question, not an empty file. */
const STARTER = {
  schema: {
    sections: [
      {
        key: 'scope',
        title: 'Scope',
        questions: [
          {
            key: 'what_is_it',
            label: 'What is being assessed?',
            type: 'long_text',
            required: true,
            legalRefs: [],
            evidence: 'none'
          }
        ]
      }
    ]
  },
  scoring: { method: 'none' }
} as const;

export async function createTemplateAction(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim();
  const kind = String(formData.get('kind') ?? '') as TemplateKind;
  if (!name || !kind) return;

  const active = await requireCapability('template.author');
  const created = await createTemplate({
    organisationId: active.membership.organisationId,
    kinds: kindsFor(active.membership.grants, 'template.author'),
    kind,
    name,
    description: String(formData.get('description') ?? '').trim() || undefined,
    jurisdiction:
      String(formData.get('jurisdiction') ?? '').trim() || undefined,
    definition: templateDefinition.parse(STARTER),
    actor: {
      actorKind: 'user',
      actorUserId: active.userId,
      actorLabel: active.email
    }
  });

  revalidatePath('/app/templates');
  redirect(`/app/templates/${created.template.id}`);
}

/**
 * `saved` says whether the draft was written: problems with a template that
 * parses are saved anyway, but JSON that does not parse is not, and a first
 * save that is refused leaves no draft at all.
 */
export type DraftResult =
  { ok: true } | { ok: false; saved: boolean; problems: string[] };

/**
 * Save a draft, reporting what is wrong rather than throwing it away.
 *
 * Three things can be wrong and they need different words: the JSON does not
 * parse, it parses but is not a template, or it is a valid template that says
 * something incoherent — a question referring to one that does not exist. The
 * last is the one worth catching before publication, and it is the one a
 * schema check alone would pass.
 */
export async function saveDraftAction(
  templateId: string,
  /** Null until the first save, which creates the draft. */
  versionId: string | null,
  _previous: DraftResult | null,
  formData: FormData
): Promise<DraftResult> {
  const active = await requireCapability('template.author');
  const read = readDraft(String(formData.get('definition') ?? ''));
  if (!read.ok) return { ok: false, saved: false, problems: read.problems };

  const problems = validateTemplate(read.definition);
  try {
    return await saveDraft(
      active,
      templateId,
      versionId,
      read.definition,
      problems
    );
  } catch (error) {
    if (error instanceof OutsideYourKinds)
      return { ok: false, saved: false, problems: [error.message] };
    // Another author's first save got there first. Their draft is not on
    // this page until it reloads, and reloading loses what is typed here, so
    // say both rather than point at a draft the person cannot see.
    if (error instanceof DraftAlreadyOpen)
      return {
        ok: false,
        saved: false,
        problems: [
          'Somebody else saved a draft of this template while you were writing, and there can be only one. Copy what you have written, then reload the page to see their draft.'
        ]
      };
    throw error;
  }
}

/**
 * Write the draft: the first save creates the version, so a draft that is
 * started and discarded never reaches the database or the audit trail.
 */
async function saveDraft(
  active: Awaited<ReturnType<typeof requireCapability>>,
  templateId: string,
  versionId: string | null,
  definition: ReturnType<typeof templateDefinition.parse>,
  problems: ReturnType<typeof validateTemplate>
): Promise<DraftResult> {
  const common = {
    organisationId: active.membership.organisationId,
    kinds: kindsFor(active.membership.grants, 'template.author'),
    definition,
    actor: {
      actorKind: 'user' as const,
      actorUserId: active.userId,
      actorLabel: active.email
    }
  };
  // Saved even with problems: a draft is working material, and refusing to
  // store half-finished logic means losing it. Publication is where this blocks.
  if (versionId) await updateDraft({ ...common, versionId });
  else await createDraftFrom({ ...common, templateId });
  revalidatePath(`/app/templates/${templateId}`);
  return problems.length > 0
    ? {
        ok: false,
        saved: true,
        problems: problems.map((p) => `${p.path}: ${p.message}`)
      }
    : { ok: true };
}

/** Set an open draft aside, with the reason. It is kept, never deleted. */
export async function abandonDraftAction(
  templateId: string,
  versionId: string,
  _previous: EditResult,
  formData: FormData
): Promise<EditResult> {
  const active = await requireCapability('template.author');
  const result = await refusable(() =>
    abandonDraft({
      organisationId: active.membership.organisationId,
      kinds: kindsFor(active.membership.grants, 'template.author'),
      versionId,
      reason: String(formData.get('reason') ?? ''),
      actor: {
        actorKind: 'user',
        actorUserId: active.userId,
        actorLabel: active.email
      }
    })
  );
  if (result?.ok) revalidatePath(`/app/templates/${templateId}`);
  return result;
}

export async function publishAction(templateId: string, versionId: string) {
  const active = await requireCapability('template.publish');
  await publishVersion({
    organisationId: active.membership.organisationId,
    kinds: kindsFor(active.membership.grants, 'template.publish'),
    versionId,
    actor: {
      actorKind: 'user',
      actorUserId: active.userId,
      actorLabel: active.email
    }
  });
  revalidatePath(`/app/templates/${templateId}`);
  revalidatePath('/app/templates');
}

/** Install the shipped templates this organisation is missing. */
export async function installShippedAction() {
  const active = await requireCapability('template.publish');
  await installShippedTemplates({
    organisationId: active.membership.organisationId,
    kinds: kindsFor(active.membership.grants, 'template.publish'),
    actor: {
      actorKind: 'user',
      actorUserId: active.userId,
      actorLabel: active.email
    }
  });
  revalidatePath('/app/templates');
}

export async function updateShippedAction() {
  const active = await requireCapability('template.publish');
  await updateShippedTemplates({
    organisationId: active.membership.organisationId,
    kinds: kindsFor(active.membership.grants, 'template.publish'),
    actor: {
      actorKind: 'user',
      actorUserId: active.userId,
      actorLabel: active.email
    }
  });
  revalidatePath('/app/templates');
}
