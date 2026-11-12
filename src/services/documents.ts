import { createHash } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';

import { db, withOrganisation, type Db } from '@/db/client';
import { documents, users } from '@/db/schema';
import { appendAuditEvent } from '@/lib/audit';
import { contentMatchesType } from '@/lib/documents/content-check';
import { ACCEPTED, MAX_BYTES, RETIRED } from '@/lib/documents/limits';
import {
  scanBuffer,
  scannerConfig,
  ScannerUnavailable
} from '@/lib/documents/scan';

import type { Actor } from './templates';
import { assertEntityIn, assertRecordIn } from './tenancy-guards';

/**
 * Files attached to a record.
 *
 * Signed agreements, due-diligence packs, forensic reports. Held in the
 * database so that a document and the audit trail about it travel together —
 * see the note on the table for why that trade was made and where it stops
 * being the right one.
 */

export type StoredDocument = Omit<typeof documents.$inferSelect, 'content'>;

export { ACCEPTED, MAX_BYTES };

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export class UploadRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadRefused';
  }
}

/** A file that passed every check, ready to store. */
export type CheckedFile = {
  filename: string;
  contentType: string;
  content: Buffer;
  sha256: string;
  scan: { scannedAt: Date; scannerVersion: string } | null;
};

/**
 * Every check a file meets before it is stored: size, type, that its contents
 * are what its type says, and the virus scanner where the deployment runs one.
 * An infected file is refused and the refusal audited against `auditAs`; its
 * bytes are never kept. Call it outside the organisation's transaction, or the
 * record of the refusal goes with the failure.
 */
export async function checkFile(input: {
  organisationId: string;
  entityId: string | null;
  filename: string;
  contentType: string;
  content: Buffer;
  actor: Actor;
  /** The record the refusal of an infected file is recorded against. */
  auditAs: { subjectType: StoredDocument['subjectType']; subjectId: string };
}): Promise<CheckedFile> {
  if (input.content.byteLength === 0) {
    throw new UploadRefused('That file is empty.');
  }
  if (input.content.byteLength > MAX_BYTES) {
    throw new UploadRefused(
      `That file is ${(input.content.byteLength / 1024 / 1024).toFixed(1)}MB. ` +
        `The limit is ${MAX_BYTES / 1024 / 1024}MB - link to it instead if it is genuinely that large.`
    );
  }
  if (RETIRED.has(input.contentType)) {
    throw new UploadRefused(
      `${RETIRED.get(input.contentType)} files are no longer accepted. ` +
        'Save it as PDF, .docx or .xlsx and attach that instead.'
    );
  }
  if (!ACCEPTED.has(input.contentType)) {
    throw new UploadRefused(
      `${input.contentType || 'That file type'} is not accepted. ` +
        `Allowed: ${[...new Set(ACCEPTED.values())].join(', ')}.`
    );
  }

  if (!contentMatchesType(input.contentType, input.content)) {
    throw new UploadRefused(
      `Its contents are not a ${ACCEPTED.get(input.contentType)} file, whatever its name says. ` +
        'It may be misnamed or damaged - open it and save it again in that format.'
    );
  }

  const sha256 = createHash('sha256').update(input.content).digest('hex');
  // Kept as sent, minus any path a browser included.
  const filename = input.filename.split(/[\\/]/).pop()!.slice(0, 200);

  // Scanned before anything is written, so an infected file is never stored,
  // not even briefly. Only where this deployment runs a scanner.
  const config = scannerConfig();
  if (!config)
    return {
      filename,
      contentType: input.contentType,
      content: input.content,
      sha256,
      scan: null
    };
  let verdict;
  try {
    verdict = await scanBuffer(input.content, config);
  } catch (error) {
    if (error instanceof ScannerUnavailable) {
      throw new UploadRefused(
        'It could not be checked for viruses just now, so it has not been attached. Try again shortly.'
      );
    }
    throw error;
  }
  if (verdict.outcome === 'infected') {
    // The refusal is the record's business: somebody tried to file
    // something infected against it, and the organisation should be able
    // to see what and when. The bytes are not kept.
    await withOrganisation(input.organisationId, () =>
      db.transaction(async (tx) => {
        await appendAuditEvent(tx, {
          ...input.actor,
          organisationId: input.organisationId,
          entityId: input.entityId ?? undefined,
          action: 'document.refused_infected',
          subjectType: input.auditAs.subjectType,
          subjectId: input.auditAs.subjectId,
          after: {
            filename,
            bytes: input.content.byteLength,
            sha256,
            signature: verdict.signature,
            scanner: verdict.scanner
          }
        });
      })
    );
    throw new UploadRefused(
      `The virus scanner found ${verdict.signature} in it, so it has not been attached.`
    );
  }
  return {
    filename,
    contentType: input.contentType,
    content: input.content,
    sha256,
    scan: { scannedAt: new Date(), scannerVersion: verdict.scanner }
  };
}

/** Store a checked file against a record, in the caller's transaction. */
export async function insertDocument(
  tx: Tx,
  input: {
    organisationId: string;
    entityId: string | null;
    subjectType: StoredDocument['subjectType'];
    subjectId: string;
    file: CheckedFile;
    description?: string | null;
    actor: Actor;
  }
) {
  const { file } = input;
  const [row] = await tx
    .insert(documents)
    .values({
      organisationId: input.organisationId,
      entityId: input.entityId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      filename: file.filename,
      contentType: file.contentType,
      byteSize: file.content.byteLength,
      sha256: file.sha256,
      description: input.description?.trim() || null,
      content: file.content,
      uploadedBy: input.actor.actorUserId ?? null,
      uploadedByLabel: input.actor.actorLabel,
      scannedAt: file.scan?.scannedAt ?? null,
      scannerVersion: file.scan?.scannerVersion ?? null
    })
    .returning({ id: documents.id, filename: documents.filename });

  await appendAuditEvent(tx, {
    ...input.actor,
    organisationId: input.organisationId,
    entityId: input.entityId ?? undefined,
    action: 'document.attached',
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    after: {
      document: row.id,
      filename: row.filename,
      bytes: file.content.byteLength,
      sha256: file.sha256,
      ...(file.scan ? { scanner: file.scan.scannerVersion } : {})
    }
  });
  return row;
}

export async function attachDocument(input: {
  organisationId: string;
  entityId: string | null;
  subjectType: StoredDocument['subjectType'];
  subjectId: string;
  filename: string;
  contentType: string;
  description?: string | null;
  content: Buffer;
  actor: Actor;
}) {
  // The record it is filed against must be this organisation's: a document
  // filed against another's supplier would appear on that supplier's page.
  await withOrganisation(input.organisationId, async () => {
    await assertRecordIn(
      input.organisationId,
      input.subjectType,
      input.subjectId
    );
    if (input.entityId)
      await assertEntityIn(input.organisationId, input.entityId);
  });
  // Outside the organisation's transaction, so the record of a refused
  // infected file is kept although the upload fails.
  const file = await checkFile({
    ...input,
    auditAs: { subjectType: input.subjectType, subjectId: input.subjectId }
  });
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      // Again, in the transaction that stores it: the record may have gone
      // while the file was being scanned.
      await assertRecordIn(
        input.organisationId,
        input.subjectType,
        input.subjectId,
        tx
      );
      return insertDocument(tx, { ...input, file });
    })
  );
}

/** Everything attached to one record. Never the bytes — those come one at a time. */
export async function documentsFor(
  organisationId: string,
  subjectType: StoredDocument['subjectType'],
  subjectId: string
): Promise<Array<StoredDocument & { uploaderEmail: string | null }>> {
  return withOrganisation(organisationId, async () => {
    const rows = await db
      .select({
        id: documents.id,
        organisationId: documents.organisationId,
        entityId: documents.entityId,
        subjectType: documents.subjectType,
        subjectId: documents.subjectId,
        filename: documents.filename,
        contentType: documents.contentType,
        byteSize: documents.byteSize,
        sha256: documents.sha256,
        description: documents.description,
        uploadedBy: documents.uploadedBy,
        uploadedByLabel: documents.uploadedByLabel,
        uploadedAt: documents.uploadedAt,
        scannedAt: documents.scannedAt,
        scannerVersion: documents.scannerVersion,
        quarantinedAt: documents.quarantinedAt,
        quarantineSignature: documents.quarantineSignature,
        uploaderEmail: users.email
      })
      .from(documents)
      .leftJoin(users, eq(users.id, documents.uploadedBy))
      .where(
        and(
          eq(documents.organisationId, organisationId),
          eq(documents.subjectType, subjectType),
          eq(documents.subjectId, subjectId)
        )
      )
      .orderBy(asc(documents.uploadedAt));
    return rows;
  });
}

/** Found infected after it was stored. Kept, but not handed out. */
export class DocumentQuarantined extends Error {
  constructor(public readonly signature: string | null) {
    super(
      'The virus scanner flagged this file, so it is held and cannot be downloaded'
    );
    this.name = 'DocumentQuarantined';
  }
}

export class ContentAltered extends Error {
  constructor() {
    super(
      'The stored file does not match the hash recorded when it was uploaded'
    );
    this.name = 'ContentAltered';
  }
}

/**
 * Read one file back, and check it is the one that went in.
 *
 * The hash is verified rather than merely stored. A platform arguing that its
 * record is tamper-evident should be able to say the agreement it hands back
 * is the agreement it was given, and refusing is better than serving something
 * that has changed underneath.
 */
export async function readDocument(id: string, organisationId: string) {
  return withOrganisation(organisationId, async () => {
    const [row] = await db
      .select()
      .from(documents)
      .where(
        and(eq(documents.id, id), eq(documents.organisationId, organisationId))
      );
    if (!row) return null;

    const actual = createHash('sha256').update(row.content).digest('hex');
    if (actual !== row.sha256) throw new ContentAltered();
    if (row.quarantinedAt)
      throw new DocumentQuarantined(row.quarantineSignature);

    return row;
  });
}

export async function recordDownload(input: {
  organisationId: string;
  document: {
    id: string;
    filename: string;
    subjectType: StoredDocument['subjectType'];
    subjectId: string;
    entityId: string | null;
  };
  actor: Actor;
}) {
  return withOrganisation(input.organisationId, async () => {
    await db.transaction(async (tx) => {
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: input.document.entityId ?? undefined,
        action: 'document.downloaded',
        subjectType: input.document.subjectType,
        subjectId: input.document.subjectId,
        // Taking a signed contract out of the building is worth knowing about,
        // for the same reason exporting the risk register is.
        after: {
          document: input.document.id,
          filename: input.document.filename
        }
      });
    });
  });
}

export async function removeDocument(input: {
  id: string;
  organisationId: string;
  actor: Actor;
}) {
  return withOrganisation(input.organisationId, async () => {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          id: documents.id,
          filename: documents.filename,
          subjectType: documents.subjectType,
          subjectId: documents.subjectId,
          entityId: documents.entityId,
          sha256: documents.sha256
        })
        .from(documents)
        .where(
          and(
            eq(documents.id, input.id),
            eq(documents.organisationId, input.organisationId)
          )
        );
      if (!row) return;

      await tx.delete(documents).where(eq(documents.id, input.id));

      // Removed for real, unlike a comment or an acceptance. A file uploaded in
      // error may be one that should never have been here, and the audit entry
      // records that it existed and who removed it.
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: row.entityId ?? undefined,
        action: 'document.removed',
        subjectType: row.subjectType,
        subjectId: row.subjectId,
        before: { document: row.id, filename: row.filename, sha256: row.sha256 }
      });
    });
  });
}

/**
 * Reattach a file to a different record.
 *
 * People upload the signed contract wherever the upload control happens to be
 * in front of them, which is often the third party rather than the agreement
 * it belongs to. Once that has happened there was no way to correct it, so the
 * agreement said "nothing attached" while the contract sat a few inches below,
 * and nobody could tell which of three PDFs governed which arrangement.
 *
 * The bytes do not move and the hash does not change. What changes is which
 * record the file hangs off, and that is audited against both records — the
 * one it left and the one it joined — because a document silently changing
 * parents is exactly the kind of thing a register has to be able to explain.
 */
export async function moveDocument(input: {
  id: string;
  organisationId: string;
  subjectType: StoredDocument['subjectType'];
  subjectId: string;
  actor: Actor;
}) {
  return withOrganisation(input.organisationId, async () => {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          id: documents.id,
          filename: documents.filename,
          subjectType: documents.subjectType,
          subjectId: documents.subjectId,
          entityId: documents.entityId
        })
        .from(documents)
        .where(
          and(
            eq(documents.id, input.id),
            eq(documents.organisationId, input.organisationId)
          )
        );
      if (!row) return null;
      if (
        row.subjectType === input.subjectType &&
        row.subjectId === input.subjectId
      )
        return row;
      await assertRecordIn(
        input.organisationId,
        input.subjectType,
        input.subjectId,
        tx
      );

      await tx
        .update(documents)
        .set({ subjectType: input.subjectType, subjectId: input.subjectId })
        .where(eq(documents.id, row.id));

      const move = {
        document: row.id,
        filename: row.filename,
        from: `${row.subjectType}:${row.subjectId}`,
        to: `${input.subjectType}:${input.subjectId}`
      };

      // Once against the record it left, so that record's history does not just
      // show a file vanishing.
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: row.entityId ?? undefined,
        action: 'document.moved',
        subjectType: row.subjectType,
        subjectId: row.subjectId,
        before: { attachedTo: move.from },
        after: move
      });
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        entityId: row.entityId ?? undefined,
        action: 'document.moved',
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        after: move
      });

      return {
        ...row,
        subjectType: input.subjectType,
        subjectId: input.subjectId
      };
    });
  });
}
