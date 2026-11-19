import { and, eq } from 'drizzle-orm';

import { db, withOrganisation } from '@/db/client';
import { importBatches } from '@/db/schema';
import { ask } from '@/lib/assistant/providers';
import { summariseRedactions } from '@/lib/assistant/redact';
import { appendAuditEvent } from '@/lib/audit';
import { CASE_HISTORY, FIELDS, type RecordType } from '@/lib/import/fields';
import {
  buildTurn,
  IMPORT_SUGGEST_PROMPT_VERSION,
  readSuggestion,
  sampleRows,
  SYSTEM
} from '@/lib/import/suggest';
import type { ImportMapping, ImportSuggestion } from '@/lib/import/types';

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

/** What, of a batch, a suggestion depends on: changed by a preview or a commit. */
const stateOf = (batch: {
  status: string;
  mapping: unknown;
  suggestion: ImportSuggestion | null;
}) =>
  JSON.stringify([batch.status, batch.mapping, batch.suggestion?.at ?? null]);

/**
 * The matching the person had on the page, kept to fields this kind of record
 * has and columns this file has: it is only ever offered back to them, and a
 * preview checks it as it checks any matching.
 */
function basisFrom(
  current: ImportMapping | undefined,
  recordType: RecordType,
  columns: readonly string[]
): ImportMapping | undefined {
  if (!current) return undefined;
  const keys = new Set(FIELDS[recordType].map((f) => f.key));
  return {
    ...current,
    fields: Object.fromEntries(
      Object.entries(current.fields).filter(
        ([key, column]) => keys.has(key) && columns.includes(column)
      )
    ),
    everyRow: Object.fromEntries(
      Object.entries(current.everyRow ?? {}).filter(([key]) => keys.has(key))
    )
  };
}

export async function suggestColumns(input: {
  organisationId: string;
  batchId: string;
  /** The matching as the person had it when they asked. */
  current?: ImportMapping;
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

  const columnsOf = {
    id: importBatches.id,
    recordType: importBatches.recordType,
    entityId: importBatches.entityId,
    columns: importBatches.columns,
    status: importBatches.status,
    mapping: importBatches.mapping,
    suggestion: importBatches.suggestion
  };
  const batch = await withOrganisation(input.organisationId, async () => {
    const [found] = await db
      .select(columnsOf)
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
  const asked = stateOf(batch);

  const recordType = batch.recordType as RecordType;
  const turn = buildTurn(
    recordType,
    batch.columns,
    await samplesFor(input.organisationId, batch.id, recordType)
  );
  const answer = await ask(configured.config, {
    system: SYSTEM,
    turns: [{ role: 'user', content: turn }],
    maxTokens: MAX_TOKENS,
    timeoutMs: TIMEOUT_MS
  });
  const read = answer.ok
    ? readSuggestion(answer.text, recordType, batch.columns)
    : null;
  const failure = answer.ok
    ? read
      ? null
      : `The model answered, but not in a shape that could be read (stopped: ${answer.stopReason ?? 'not stated'}; ${answer.text.length} characters). Try again.`
    : answer.timedOut
      ? `The model did not answer within ${TIMEOUT_MS / 1000} seconds. Try again.`
      : answer.reason;

  const earlier = batch.suggestion;
  const basis = basisFrom(input.current, recordType, batch.columns);
  const suggestion: ImportSuggestion =
    read || !earlier
      ? {
          model: configured.config.model,
          promptVersion: IMPORT_SUGGEST_PROMPT_VERSION,
          at: new Date().toISOString(),
          byLabel: input.actor.actorLabel,
          fields: read?.fields ?? {},
          notes: read?.notes ?? null,
          minimisation: summariseRedactions(answer.redactions),
          failure,
          ...(basis ? { basis } : {})
        }
      : // A request that failed keeps what the last one suggested.
        { ...earlier, failure, ...(basis ? { basis } : {}) };

  const kept = await withOrganisation(input.organisationId, () =>
    db.transaction(async (t) => {
      const [now] = await t
        .select(columnsOf)
        .from(importBatches)
        .where(eq(importBatches.id, batch.id))
        .for('update');
      // Previewed, imported or asked again while the model was answering:
      // what it said was for a matching that is no longer on the page.
      const current = Boolean(now) && stateOf(now) === asked;
      if (current)
        await t
          .update(importBatches)
          .set({ suggestion })
          .where(eq(importBatches.id, batch.id));
      // The request is audited either way, as the file's header went out.
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
          model: configured.config.model,
          promptVersion: IMPORT_SUGGEST_PROMPT_VERSION,
          suggested: Object.keys(read?.fields ?? {}).length,
          dropped: read?.dropped ?? 0,
          redactions: answer.redactions,
          failure,
          ...(current ? {} : { discarded: true })
        }
      });
      return current;
    })
  );
  if (!kept)
    throw new ImportRefused(
      'The import changed while the model was answering, so its suggestion was set aside. Ask again if you still want one.'
    );
  return suggestion;
}

/**
 * The sample rows to send. Case history sends none, so its file is not read
 * at all; otherwise the file is read once more for its first rows.
 */
async function samplesFor(
  organisationId: string,
  batchId: string,
  recordType: RecordType
): Promise<string[][]> {
  if (CASE_HISTORY.has(recordType)) return [];
  const [row] = await withOrganisation(organisationId, () =>
    db
      .select({ file: importBatches.file })
      .from(importBatches)
      .where(eq(importBatches.id, batchId))
  );
  if (!row) return [];
  const table = await readImportTable(row.file);
  return sampleRows(recordType, table.columns, table.rows);
}
