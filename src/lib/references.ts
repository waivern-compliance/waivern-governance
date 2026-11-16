import { sql } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { referenceCounters } from '@/db/schema';

type Executor = Pick<Db, 'execute'>;

/**
 * The next human reference for a record, such as `RISK-2026-0001`.
 *
 * One counter per organisation, prefix and year, taken with an upsert so two
 * records created at once never share a number. Run it inside the
 * transaction that inserts the record, so a refused insert gives its number
 * back.
 */
export async function nextReference(
  executor: Executor,
  organisationId: string,
  prefix: string,
  year: number
): Promise<string> {
  const rows = await executor.execute<{ next_value: number | string }>(sql`
    insert into ${referenceCounters} (organisation_id, prefix, year, next_value)
    values (${organisationId}, ${prefix}, ${year}, 1)
    on conflict (organisation_id, prefix, year)
      do update set next_value = ${referenceCounters}.next_value + 1
    returning next_value
  `);
  return `${prefix}-${year}-${String(Number(rows[0]?.next_value ?? 1)).padStart(4, '0')}`;
}
