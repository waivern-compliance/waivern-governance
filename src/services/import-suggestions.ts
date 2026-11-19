import { and, eq } from 'drizzle-orm';

import { db, withOrganisation } from '@/db/client';
import { importBatches } from '@/db/schema';
import { ask } from '@/lib/assistant/providers';
import { summariseRedactions } from '@/lib/assistant/redact';
import { appendAuditEvent } from '@/lib/audit';
import type { RecordType } from '@/lib/import/fields';
import {
  buildTurn,
  IMPORT_SUGGEST_PROMPT_VERSION,
  readSuggestion,
  sampleRows,
  SYSTEM
} from '@/lib/import/suggest';
import type { ImportSuggestion } from '@/lib/import/types';

import { providerFor } from './assistant';
import { ImportRefused, readImportTable } from './imports';
import type { Actor } from './templates';
import { refuseDuringTrial } from './trial-guard';

/**
 * Asking the organisation's own model how an unfamiliar file's columns match
 * (issue #86). Nothing here writes a mapping: the suggestion is kept on the
 * batch and offered beside the matching, and a person previewing is what makes
 * it one. Only what `lib/import/suggest.ts` builds is sent.
 */

/** A header row and three rows are small: a long wait means something is wrong. */
const TIMEOUT_MS = 30_000;
const MAX_TOKENS = 4096;

/** Whether the button should be offered at all. */
export async function importSuggestionsAvailable(
  organisationId: string
): Promise<boolean> {
  const configured = await providerFor(organisationId);
  return Boolean(configured?.surfaces.includes('import_mapping'));
}

export async function suggestColumns(input: {
  organisationId: string;
  batchId: string;
  actor: Actor;
}): Promise<ImportSuggestion> {
  const configured = await providerFor(input.organisationId);
  if (!configured)
    throw new ImportRefused(
      'No model is configured. An administrator sets one up under Admin → Assistant.'
    );
  if (!configured.surfaces.includes('import_mapping'))
    throw new ImportRefused(
      'Suggesting a matching is switched off for this organisation. An administrator can enable it under Admin → Assistant.'
    );
  await refuseDuringTrial(input.organisationId, 'contact.outside');

  const batch = await withOrganisation(input.organisationId, async () => {
    const [found] = await db
      .select({
        id: importBatches.id,
        recordType: importBatches.recordType,
        entityId: importBatches.entityId,
        file: importBatches.file,
        status: importBatches.status
      })
      .from(importBatches)
      .where(
        and(
          eq(importBatches.id, input.batchId),
          eq(importBatches.organisationId, input.organisationId)
        )
      );
    return found;
  });
  if (!batch) throw new ImportRefused('No such import.');
  if (batch.status !== 'uploaded' && batch.status !== 'previewed')
    throw new ImportRefused(
      'This import is no longer being matched, so there is nothing to suggest.'
    );

  const recordType = batch.recordType as RecordType;
  const table = await readImportTable(batch.file);
  const turn = buildTurn(
    recordType,
    table.columns,
    sampleRows(recordType, table.columns, table.rows)
  );
  const answer = await ask(configured.config, {
    system: SYSTEM,
    turns: [{ role: 'user', content: turn }],
    maxTokens: MAX_TOKENS,
    timeoutMs: TIMEOUT_MS
  });
  const read = answer.ok
    ? readSuggestion(answer.text, recordType, table.columns)
    : null;
  const failure = answer.ok
    ? read
      ? null
      : `The model answered, but not in a shape that could be read (stopped: ${answer.stopReason ?? 'not stated'}; ${answer.text.length} characters). Try again.`
    : answer.timedOut
      ? `The model did not answer within ${TIMEOUT_MS / 1000} seconds. Try again.`
      : answer.reason;

  const suggestion: ImportSuggestion = {
    model: configured.config.model,
    promptVersion: IMPORT_SUGGEST_PROMPT_VERSION,
    at: new Date().toISOString(),
    byLabel: input.actor.actorLabel,
    fields: read?.fields ?? {},
    notes: read?.notes ?? null,
    minimisation: summariseRedactions(answer.redactions),
    failure
  };

  await withOrganisation(input.organisationId, () =>
    db.transaction(async (t) => {
      await t
        .update(importBatches)
        .set({ suggestion })
        .where(eq(importBatches.id, batch.id));
      // Counts and provenance only: no column names or cells from the file.
      await appendAuditEvent(t, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: batch.entityId ?? undefined,
        action: 'import.mapping_suggested',
        subjectType: 'organisation',
        subjectId: input.organisationId,
        after: {
          batch: batch.id,
          recordType,
          model: suggestion.model,
          promptVersion: suggestion.promptVersion,
          suggested: Object.keys(suggestion.fields).length,
          dropped: read?.dropped ?? 0,
          redactions: answer.redactions,
          failure
        }
      });
    })
  );
  return suggestion;
}
