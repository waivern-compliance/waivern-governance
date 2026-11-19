import { eq } from 'drizzle-orm';

import { db, withOrganisation } from '@/db/client';
import { entities } from '@/db/schema';
import type { AiFrameworkId } from '@/lib/ai-frameworks';
import { ukLawApplies } from '@/lib/dpa2018/applies';
import { entityEprivacy } from '@/lib/ie-eprivacy/scope';

import { aiFrameworkOf } from './ai-framework';
import { cyberEssentialsEnabled } from './cyber-essentials';

/**
 * Which parts of Govern an organisation's own facts put in front of it.
 *
 * Derived, never chosen: the privacy programme is offered because some entity
 * is subject to UK or EU data protection law, not because somebody ticked a
 * box. A US company recorded as under neither gets the AI governance programme
 * alone. This decides what is offered, never what may be done: every page
 * still checks its capability, and a page for a programme out of scope still
 * opens when its address is typed.
 */
export type ProgrammeScope = {
  /** Some entity is subject to UK or EU data protection law. */
  privacy: boolean;
  /** Some entity is subject to UK law: the Data Protection Act 2018's pages. */
  ukLaw: boolean;
  /** Some entity is under UK PECR or the Irish ePrivacy Regulations. */
  eprivacy: boolean;
  /** Some entity answers freedom of information requests. */
  foi: boolean;
  /** The organisation has turned Cyber Essentials on. */
  cyberEssentials: boolean;
  /** The AI governance framework it follows. */
  aiFramework: AiFrameworkId;
};

/**
 * Read once per page, from one read of the entities, and handed to whatever
 * else on the page needs it. The `anyEntityUnder…` helpers in `entities.ts`
 * answer the same questions one at a time, for callers that need only one.
 */
export async function programmeScope(
  organisationId: string
): Promise<ProgrammeScope> {
  const [rows, cyberEssentials, aiFramework] = await Promise.all([
    withOrganisation(organisationId, () =>
      db
        .select({
          name: entities.name,
          dataProtectionLaw: entities.dataProtectionLaw,
          applies: entities.dataProtectionLawApplies,
          ieEprivacy: entities.ieEprivacy,
          foiAct: entities.foiAct
        })
        .from(entities)
        .where(eq(entities.organisationId, organisationId))
    ),
    cyberEssentialsEnabled(organisationId),
    aiFrameworkOf(organisationId)
  ]);
  // With no entity yet, as when an organisation is first set up, its default
  // will be under UK law, so the privacy programme is offered.
  const fresh = rows.length === 0;
  const under = rows.filter((r) => r.applies);
  return {
    privacy: fresh || under.length > 0,
    ukLaw: fresh || under.some((r) => ukLawApplies(r.dataProtectionLaw)),
    eprivacy: fresh || under.some((r) => entityEprivacy(r) !== null),
    foi: rows.some((r) => r.foiAct !== null),
    cyberEssentials,
    aiFramework
  };
}
