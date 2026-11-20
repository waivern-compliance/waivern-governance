import { and, eq } from 'drizzle-orm';

import { db, withOrganisation } from '@/db/client';
import { assessments, entities, templateVersions } from '@/db/schema';
import {
  hiddenBecause,
  KIND_PROGRAMME,
  programmeHidden,
  SYSTEM_TEMPLATES,
  type HiddenBecause,
  type TemplateRelevance
} from '@/lib/templates/library';

import { programmeScope, type ProgrammeScope } from './programme-scope';
import type { templateLibrary } from './templates';

type Library = Awaited<ReturnType<typeof templateLibrary>>;

/**
 * Which templates in an organisation's library its library hides by default,
 * and why, with what it has declared that decided it.
 *
 * Presentation only, like `programmeScope`: every template stays one click
 * away and opens by its address. A shipped template is hidden where
 * `hiddenBecause` says the organisation's declared programmes and laws do not
 * reach it, and a system template no longer shipped under its name is judged
 * by its kind. Whatever the organisation has made its own is never hidden: a
 * template it created or copied, one with an assessment against it, and one
 * with a draft somebody is editing.
 *
 * Takes the library the page reads anyway, so the templates and their
 * versions are not read twice; given as the pending read, its own reads run
 * alongside it.
 */
export async function hiddenTemplates(
  organisationId: string,
  library: Library | Promise<Library>
): Promise<{
  hidden: Map<string, HiddenBecause>;
  scope: ProgrammeScope;
  audience: TemplateRelevance;
}> {
  const [scope, [under, used], rows] = await Promise.all([
    programmeScope(organisationId),
    withOrganisation(organisationId, () =>
      Promise.all([
        db
          .select({
            competentAuthority: entities.competentAuthority,
            irishProvider: entities.ieCommsProvider
          })
          .from(entities)
          .where(
            and(
              eq(entities.organisationId, organisationId),
              eq(entities.dataProtectionLawApplies, true)
            )
          ),
        db
          .selectDistinct({ id: templateVersions.templateId })
          .from(assessments)
          .innerJoin(
            templateVersions,
            eq(templateVersions.id, assessments.templateVersionId)
          )
          .where(eq(assessments.organisationId, organisationId))
      ])
    ),
    library
  ]);
  const audience: TemplateRelevance = {
    ...scope,
    competentAuthority: under.some((e) => e.competentAuthority),
    irishProvider: under.some((e) => e.irishProvider)
  };
  const usedIds = new Set(used.map((r) => r.id));
  const hidden = new Map<string, HiddenBecause>();
  for (const { template, versions } of rows) {
    if (!template.isSystem || usedIds.has(template.id)) continue;
    if (versions.some((v) => v.status === 'draft')) continue;
    const shipped = SYSTEM_TEMPLATES.find((s) => s.name === template.name);
    const programme = KIND_PROGRAMME[template.kind];
    const why = shipped
      ? hiddenBecause(shipped, audience)
      : programme
        ? programmeHidden(programme, audience)
        : null;
    if (why) hidden.set(template.id, why);
  }
  return { hidden, scope, audience };
}
