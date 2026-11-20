import { and, eq } from 'drizzle-orm';

import { db, withOrganisation } from '@/db/client';
import {
  assessments,
  entities,
  templates,
  templateVersions
} from '@/db/schema';
import { relevantTo, SYSTEM_TEMPLATES } from '@/lib/templates/library';

import { programmeScope, type ProgrammeScope } from './programme-scope';

/**
 * The templates in an organisation's library that its library shows by
 * default, and the scope that decided it.
 *
 * Presentation only, like `programmeScope`: every template stays one click
 * away and opens by its address. A shipped template is shown where
 * `relevantTo` says the organisation's declared programmes and laws reach it.
 * Whatever the organisation has made its own is always shown: a template it
 * created or copied, one with an assessment against it, and one with a draft
 * somebody is editing. So is a system template no longer in the shipped
 * library, which there is nothing to judge by.
 */
export async function relevantTemplates(organisationId: string): Promise<{
  ids: Set<string>;
  scope: ProgrammeScope;
}> {
  const scope = await programmeScope(organisationId);
  return withOrganisation(organisationId, async () => {
    const [held, under, used, drafting] = await Promise.all([
      db
        .select({
          id: templates.id,
          name: templates.name,
          isSystem: templates.isSystem
        })
        .from(templates)
        .where(eq(templates.organisationId, organisationId)),
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
        .where(eq(assessments.organisationId, organisationId)),
      db
        .selectDistinct({ id: templateVersions.templateId })
        .from(templateVersions)
        .innerJoin(templates, eq(templates.id, templateVersions.templateId))
        .where(
          and(
            eq(templates.organisationId, organisationId),
            eq(templateVersions.status, 'draft')
          )
        )
    ]);
    const audience = {
      ...scope,
      competentAuthority: under.some((e) => e.competentAuthority),
      irishProvider: under.some((e) => e.irishProvider)
    };
    const own = new Set([...used, ...drafting].map((r) => r.id));
    const ids = held
      .filter((t) => {
        if (!t.isSystem || own.has(t.id)) return true;
        const shipped = SYSTEM_TEMPLATES.find((s) => s.name === t.name);
        return !shipped || relevantTo(shipped, audience);
      })
      .map((t) => t.id);
    return { ids: new Set(ids), scope };
  });
}
