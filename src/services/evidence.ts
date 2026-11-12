import { and, desc, eq, inArray, isNull } from 'drizzle-orm';

import { db, withOrganisation } from '@/db/client';
import {
  assessments,
  documents,
  entities,
  evidence,
  importSources,
  integrationConnections,
  processingActivities,
  recordLinks,
  risks
} from '@/db/schema';

/**
 * The evidence register: what supports the organisation's records, where it
 * came from, the files kept with it and the records it supports. Evidence
 * arrives from connected tools (the Integration API) or from an import.
 */
export async function evidenceRegister(
  organisationId: string,
  /** The entities the reader may see; `null` means every one. */
  entityIds: readonly string[] | null
) {
  return withOrganisation(organisationId, async () => {
    if (entityIds && entityIds.length === 0) return [];
    const rows = await db
      .select({
        id: evidence.id,
        entityId: evidence.entityId,
        entityName: entities.name,
        kind: evidence.kind,
        title: evidence.title,
        description: evidence.description,
        uri: evidence.uri,
        collectedAt: evidence.collectedAt,
        createdAt: evidence.createdAt,
        connectionName: integrationConnections.name,
        importSourceId: evidence.importSourceId,
        importSourceName: importSources.name,
        importBatchId: evidence.importBatchId,
        importConfirmedAt: evidence.importConfirmedAt,
        legacy: evidence.legacy
      })
      .from(evidence)
      .innerJoin(entities, eq(entities.id, evidence.entityId))
      .leftJoin(
        integrationConnections,
        eq(integrationConnections.id, evidence.sourceConnectionId)
      )
      .leftJoin(importSources, eq(importSources.id, evidence.importSourceId))
      .where(
        and(
          eq(evidence.organisationId, organisationId),
          entityIds ? inArray(evidence.entityId, [...entityIds]) : undefined
        )
      )
      .orderBy(desc(evidence.createdAt));
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);

    const [files, links] = await Promise.all([
      db
        .select({
          id: documents.id,
          subjectId: documents.subjectId,
          filename: documents.filename
        })
        .from(documents)
        .where(
          and(
            eq(documents.organisationId, organisationId),
            eq(documents.subjectType, 'evidence'),
            inArray(documents.subjectId, ids),
            isNull(documents.quarantinedAt)
          )
        ),
      db
        .select({
          fromId: recordLinks.fromId,
          toType: recordLinks.toType,
          toId: recordLinks.toId
        })
        .from(recordLinks)
        .where(
          and(
            eq(recordLinks.organisationId, organisationId),
            eq(recordLinks.fromType, 'evidence'),
            inArray(recordLinks.fromId, ids)
          )
        )
    ]);

    // The references of what it supports, so the page can name them.
    const byType = (t: string) =>
      links.filter((l) => l.toType === t).map((l) => l.toId);
    const [a, p, r] = await Promise.all(
      (
        [
          [assessments, byType('assessment')],
          [processingActivities, byType('processing_activity')],
          [risks, byType('risk')]
        ] as const
      ).map(([table, wanted]) =>
        wanted.length
          ? db
              .select({ id: table.id, reference: table.reference })
              .from(table)
              .where(
                and(
                  inArray(table.id, wanted),
                  // Only records the reader may see: a link to another
                  // entity's record is not shown, nor its reference.
                  entityIds
                    ? inArray(table.entityId, [...entityIds])
                    : undefined
                )
              )
          : Promise.resolve([] as Array<{ id: string; reference: string }>)
      )
    );
    const reference = new Map(
      [...a, ...p, ...r].map((x) => [x.id, x.reference])
    );

    return rows.map((row) => ({
      ...row,
      files: files.filter((f) => f.subjectId === row.id),
      supports: links
        .filter((l) => l.fromId === row.id && reference.has(l.toId))
        .map((l) => ({
          type: l.toType,
          id: l.toId,
          reference: reference.get(l.toId) ?? null
        }))
    }));
  });
}
