import { evidenceBatch } from '@/lib/integration/contracts';
import { ingestRoute } from '@/lib/integration/handler';
import { ingestEvidence } from '@/services/ingest';

export const dynamic = 'force-dynamic';

/** Documents, attestations and links supporting a governance record. */
export const POST = ingestRoute({
  schema: evidenceBatch,
  kinds: ['waivern_portal', 'har_analyser', 'other'],
  handle: (connection, input) => ingestEvidence(connection, input.records)
});
