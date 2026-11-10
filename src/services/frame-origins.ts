import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/db/client';
import { dsrIntakeLinks, entities } from '@/db/schema';
import { formIsOpen } from '@/lib/intake-forms';

/**
 * The websites that may frame a public form, for the proxy's
 * `frame-ancestors`. Kept apart from `dsr-intake` so the proxy, which runs on
 * every page, loads one query and not the whole intake and complaints code.
 *
 * A form is frameable only while it is open, by the same rule the page uses:
 * not withdrawn, and for a freedom of information form, an Act still applies
 * to its entity.
 *
 * Answers are kept for a few seconds, since every view and every submission
 * of a form asks. A change made on this instance clears them at once; another
 * instance can lag by at most `TTL_MS`, which only matters when a website is
 * taken off the list, and a few seconds of that is harmless.
 */

const TTL_MS = 5_000;
const MAX_ENTRIES = 1_000;
const cache = new Map<string, { origins: string[]; until: number }>();

/** Forget every cached answer, after a form's websites or status change. */
export function forgetFrameOrigins(): void {
  cache.clear();
}

/** Read before any organisation is known: the address is the only authority. */
export async function frameOriginsForSlug(slug: string): Promise<string[]> {
  const now = Date.now();
  const hit = cache.get(slug);
  if (hit && hit.until > now) return hit.origins;

  const [row] = await db
    .select({
      origins: dsrIntakeLinks.frameOrigins,
      kind: dsrIntakeLinks.kind,
      foiAct: entities.foiAct
    })
    .from(dsrIntakeLinks)
    .innerJoin(entities, eq(entities.id, dsrIntakeLinks.entityId))
    .where(
      and(eq(dsrIntakeLinks.slug, slug), isNull(dsrIntakeLinks.revokedAt))
    );
  const origins =
    row && formIsOpen({ revokedAt: null, ...row }) ? row.origins : [];

  if (cache.size >= MAX_ENTRIES) cache.clear();
  cache.set(slug, { origins, until: now + TTL_MS });
  return origins;
}
