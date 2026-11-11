import { and, eq } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { entities } from '@/db/schema';
import { regulatorFor } from '@/lib/gdpr/establishment';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * The regulator for an entity under one law, as it reads now. Complaints and
 * requests store the words when they record contact or a response, so a later
 * change of lead authority does not rewrite what was said then.
 */
export async function regulatorOfEntity(
  tx: Tx,
  organisationId: string,
  entityId: string,
  jurisdiction: 'uk' | 'eu' | 'uk_eu'
) {
  const [row] = await tx
    .select({
      euLeadAuthority: entities.euLeadAuthority,
      euEstablishments: entities.euEstablishments,
      euMainEstablishment: entities.euMainEstablishment
    })
    .from(entities)
    .where(
      and(
        eq(entities.id, entityId),
        eq(entities.organisationId, organisationId)
      )
    );
  return regulatorFor(
    jurisdiction,
    row ?? {
      euLeadAuthority: null,
      euEstablishments: [],
      euMainEstablishment: null
    }
  );
}

/** What a record made before the words were stored would have said. */
export function regulatorWithoutEstablishment(
  jurisdiction: 'uk' | 'eu' | 'uk_eu'
) {
  return regulatorFor(jurisdiction, {
    euLeadAuthority: null,
    euEstablishments: [],
    euMainEstablishment: null
  });
}
