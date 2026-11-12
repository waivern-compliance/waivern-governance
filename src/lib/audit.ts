import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import { db, type Db } from '@/db/client';
import { auditChainHeads, auditEvents } from '@/db/schema';

import { canonicalise, sha256Hex } from './canonical';

/** Predecessor hash of the first event in an organisation's chain. */
export const GENESIS_HASH = '0'.repeat(64);

/**
 * The scheme new events are written under.
 *
 * 1. The hash covers the event's contents (before, after, metadata) directly.
 *    Every event written before this change.
 * 2. The hash covers `content_digest`, a SHA-256 of those contents, so the
 *    contents can be erased (`eraseAuditContents`) and the chain still
 *    verifies.
 */
export const CURRENT_SCHEME = 2;

/** The action of the event that moves a chain from scheme 1 to scheme 2. */
export const SCHEME_CHANGED = 'audit.scheme_changed';
/** The action of the event that records erasing other events' contents. */
export const CONTENTS_ERASED = 'audit.contents_erased';

export type ActorKind =
  | 'user'
  | 'contributor_link'
  | 'system'
  /** Authored a suggestion. Never the actor on a decision. */
  | 'assistant'
  | 'integration'
  | 'public_form';

export type AuditInput = {
  organisationId: string;
  actorKind: ActorKind;
  /** Present for signed-in users; absent for link contributors and system work. */
  actorUserId?: string | null;
  /** Email, integration name or process name — always populated. */
  actorLabel: string;
  /** Namespaced past-tense verb, e.g. `assessment.submitted`. */
  action: string;
  subjectType: (typeof auditEvents.$inferInsert)['subjectType'];
  subjectId: string;
  entityId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
};

type Fields = {
  organisationId: string;
  seq: number;
  at: Date;
  actorKind: string;
  actorUserId?: string | null;
  actorLabel: string;
  action: string;
  subjectType: string;
  subjectId: string;
  entityId?: string | null;
  prevHash: string;
};

type Contents = {
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
};

/** SHA-256 of the canonical [before | null, after | null, metadata]. */
export function contentDigest(e: Contents): Promise<string> {
  return sha256Hex(
    canonicalise([e.before ?? null, e.after ?? null, e.metadata])
  );
}

/** Scheme 1: the exact fields, in the exact order, that the hash covers. */
function payloadV1(e: Fields & Contents) {
  return canonicalise([
    e.organisationId,
    e.seq,
    e.at.toISOString(),
    e.actorKind,
    e.actorUserId ?? null,
    e.actorLabel,
    e.action,
    e.subjectType,
    e.subjectId,
    e.entityId ?? null,
    e.before ?? null,
    e.after ?? null,
    e.metadata,
    e.prevHash
  ]);
}

/**
 * Scheme 2: as scheme 1, with the contents replaced by their digest and a
 * marker first, so no scheme 1 payload can be read as a scheme 2 one.
 */
function payloadV2(e: Fields & { contentDigest: string }) {
  return canonicalise([
    'govern-audit-2',
    e.organisationId,
    e.seq,
    e.at.toISOString(),
    e.actorKind,
    e.actorUserId ?? null,
    e.actorLabel,
    e.action,
    e.subjectType,
    e.subjectId,
    e.entityId ?? null,
    e.contentDigest,
    e.prevHash
  ]);
}

/**
 * What a scheme 1 event commits to once its chain has moved to scheme 2: the
 * scheme 2 payload over its own fields and digest. Its original hash still
 * stands; this is what lets it be checked after its contents are erased.
 */
function commitmentOf(e: Fields & { contentDigest: string }) {
  return sha256Hex(payloadV2(e));
}

/** The digest over every scheme 1 event's commitment, in sequence order. */
function rootOf(commitments: string[]) {
  return sha256Hex(canonicalise(commitments));
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

type Head = { seq: number; headHash: string; scheme: number };

/**
 * Lock the organisation's chain head, creating it on first use, and move a
 * chain begun under scheme 1 to the current scheme.
 *
 * INSERT ... ON CONFLICT DO UPDATE takes a row lock on the conflicting row,
 * which both creates the chain head on first use and serialises concurrent
 * appends behind it. Two writers cannot read the same predecessor, so the
 * chain cannot fork or skip a sequence number.
 */
async function lockHead(tx: Tx, organisationId: string): Promise<Head> {
  const rows = await tx.execute<{
    seq: number | string;
    head_hash: string;
    scheme: number;
  }>(sql`
    insert into ${auditChainHeads} (organisation_id, seq, head_hash, scheme)
    values (${organisationId}, 0, ${GENESIS_HASH}, ${CURRENT_SCHEME})
    on conflict (organisation_id)
      do update set updated_at = now()
    returning seq, head_hash, scheme
  `);
  const head = rows[0];
  if (!head) throw new Error('Could not lock the audit chain head');
  const locked = {
    seq: Number(head.seq),
    headHash: head.head_hash,
    scheme: Number(head.scheme)
  };
  return locked.scheme < CURRENT_SCHEME
    ? moveToScheme2(tx, organisationId, locked)
    : locked;
}

/** Write one scheme 2 event after `head`, and move the head to it. */
async function write(tx: Tx, input: AuditInput, head: Head) {
  const seq = head.seq + 1;
  const at = new Date();
  const metadata = input.metadata ?? {};
  const prevHash = head.headHash;
  const digest = await contentDigest({ ...input, metadata });
  const hash = await sha256Hex(
    payloadV2({ ...input, seq, at, prevHash, contentDigest: digest })
  );

  const [row] = await tx
    .insert(auditEvents)
    .values({
      organisationId: input.organisationId,
      seq,
      at,
      actorKind: input.actorKind,
      actorUserId: input.actorUserId ?? null,
      actorLabel: input.actorLabel,
      action: input.action,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      entityId: input.entityId ?? null,
      before: input.before ?? null,
      after: input.after ?? null,
      metadata,
      prevHash,
      hash,
      scheme: CURRENT_SCHEME,
      contentDigest: digest
    })
    .returning();

  await tx
    .update(auditChainHeads)
    .set({ seq, headHash: hash, updatedAt: at })
    .where(eq(auditChainHeads.organisationId, input.organisationId));

  return { row, head: { seq, headHash: hash, scheme: CURRENT_SCHEME } };
}

/**
 * Move a chain begun under scheme 1 to scheme 2, without rewriting any
 * existing hash.
 *
 * Every existing event keeps its hash, so every export already handed out
 * still verifies exactly as it did. Each gets its content digest recorded,
 * once, and one declared event, `audit.scheme_changed`, follows the old head.
 * It names the old head hash (which is also its predecessor), how many events
 * were converted, and a root digest over each old event's scheme 2
 * commitment. Its own hash is the new head, and the chain carries on from it
 * under scheme 2.
 *
 * The root is what keeps an old event checkable after its contents are
 * erased: its commitment can still be recomputed from its fields and digest,
 * and the root, inside a hashed event, cannot be changed to fit a forgery.
 */
async function moveToScheme2(
  tx: Tx,
  organisationId: string,
  head: Head
): Promise<Head> {
  await tx
    .update(auditChainHeads)
    .set({ scheme: CURRENT_SCHEME })
    .where(eq(auditChainHeads.organisationId, organisationId));
  if (head.seq === 0) return { ...head, scheme: CURRENT_SCHEME };

  const old = await tx
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.organisationId, organisationId))
    .orderBy(asc(auditEvents.seq));
  const commitments: string[] = [];
  const ids: string[] = [];
  const digests: string[] = [];
  for (const e of old) {
    const digest = e.contentDigest ?? (await contentDigest(e));
    commitments.push(await commitmentOf({ ...e, contentDigest: digest }));
    if (!e.contentDigest) {
      ids.push(e.id);
      digests.push(digest);
    }
  }
  if (ids.length > 0) {
    await tx.execute(
      sql`select set_config('govern.audit_conversion', ${organisationId}, true)`
    );
    await tx.execute(sql`
      update audit_event a set content_digest = v.digest
      from (
        select unnest(string_to_array(${ids.join(',')}, ',')::uuid[]) as id,
               unnest(string_to_array(${digests.join(',')}, ',')) as digest
      ) v
      where a.id = v.id and a.organisation_id = ${organisationId}`);
    await tx.execute(
      sql`select set_config('govern.audit_conversion', '', true)`
    );
  }

  const { head: moved } = await write(
    tx,
    {
      organisationId,
      actorKind: 'system',
      actorLabel: 'Govern audit chain upgrade',
      action: SCHEME_CHANGED,
      subjectType: 'organisation',
      subjectId: organisationId,
      metadata: {
        fromScheme: 1,
        toScheme: CURRENT_SCHEME,
        oldHeadSeq: head.seq,
        oldHeadHash: head.headHash,
        convertedEvents: old.length,
        commitmentRoot: await rootOf(commitments),
        authorisedBy:
          'Waivern Limited, by releasing migration 0112_audit_content_digest',
        reason:
          "Hashes now cover a digest of each event's contents, so the contents can be erased while the chain still verifies."
      }
    },
    { ...head, scheme: CURRENT_SCHEME }
  );
  return moved;
}

/**
 * Append one event to an organisation's chain.
 *
 * Must run inside a transaction, and callers should pass the same transaction
 * that made the change being audited — so a change either lands with its audit
 * record or does not land at all. There is deliberately no way to write a
 * record change and its audit event independently.
 */
export async function appendAuditEvent(tx: Tx, input: AuditInput) {
  const head = await lockHead(tx, input.organisationId);
  const { row } = await write(tx, input, head);
  return row;
}

/** Convenience wrapper for a change that has nothing else to write. */
export async function audit(input: AuditInput) {
  return db.transaction((tx) => appendAuditEvent(tx, input));
}

/**
 * Erase the contents of some of an organisation's audit events: the only
 * change ever made to an audit event once written.
 *
 * `before` and `after` are cleared and `metadata` emptied. The digest of what
 * they held, and every other field, stay, so each event and the chain around
 * it still verify. The erasure is itself an event, `audit.contents_erased`,
 * written first in the same transaction and listing the sequence numbers it
 * erases, and each erased event names it; the database refuses an erasure
 * that does not (migration 0112). For where the records the events describe
 * have been deleted for good, such as deleting a legal entity.
 */
export async function eraseAuditContents(
  tx: Tx,
  input: {
    organisationId: string;
    eventIds: string[];
    /** Why, for the record. Never anything from the contents. */
    reason: string;
    actor: Pick<AuditInput, 'actorKind' | 'actorUserId' | 'actorLabel'>;
    /** What the erasure is part of: the record deleted, by id. */
    subject: Pick<AuditInput, 'subjectType' | 'subjectId'>;
  }
): Promise<{ erased: number; eventId: string | null }> {
  const head = await lockHead(tx, input.organisationId);
  if (input.eventIds.length === 0) return { erased: 0, eventId: null };
  const targets = await tx
    .select({ id: auditEvents.id, seq: auditEvents.seq })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.organisationId, input.organisationId),
        anyId(input.eventIds),
        isNull(auditEvents.erasedAt)
      )
    )
    .orderBy(asc(auditEvents.seq));
  if (targets.length === 0) return { erased: 0, eventId: null };

  const { row } = await write(
    tx,
    {
      ...input.actor,
      ...input.subject,
      organisationId: input.organisationId,
      action: CONTENTS_ERASED,
      metadata: {
        reason: input.reason,
        count: targets.length,
        seqs: targets.map((t) => t.seq)
      }
    },
    head
  );
  await tx
    .update(auditEvents)
    .set({
      before: null,
      after: null,
      metadata: {},
      erasedAt: row.at,
      erasedBy: row.id
    })
    .where(
      and(
        eq(auditEvents.organisationId, input.organisationId),
        anyId(targets.map((t) => t.id))
      )
    );
  return { erased: targets.length, eventId: row.id };
}

/**
 * `id = any(...)` with every id in one parameter. `inArray` binds one
 * parameter per id, and Postgres refuses more than 65,535 in a statement,
 * which a large entity's audit trail can pass.
 */
function anyId(ids: string[]) {
  return sql`${auditEvents.id} = any(string_to_array(${ids.join(',')}, ',')::uuid[])`;
}

export type ChainVerification =
  | {
      ok: true;
      events: number;
      headHash: string;
      /** Events whose contents were erased, each checked from its digest. */
      erased: number;
    }
  | {
      ok: false;
      events: number;
      failedAtSeq: number;
      reason:
        | 'hash_mismatch'
        | 'broken_link'
        | 'sequence_gap'
        /** The contents do not match the digest recorded for them. */
        | 'digest_mismatch'
        /** Contents gone with no declared erasure naming the event. */
        | 'undeclared_erasure'
        /** A scheme out of order, or old events their scheme change does not commit to. */
        | 'scheme_mismatch';
    };

/**
 * Recompute the whole chain and report the first break.
 *
 * This is the same routine an auditor runs against an export, which is the
 * point: the client does not have to trust our word that the log is intact.
 * See `verifyEvents` for what is checked.
 */
export async function verifyAuditChain(
  organisationId: string
): Promise<ChainVerification> {
  const events = await db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.organisationId, organisationId))
    .orderBy(asc(auditEvents.seq));
  return verifyEvents(events);
}

type StoredEvent = typeof auditEvents.$inferSelect;

/**
 * Check a whole chain, in sequence order.
 *
 * Every event's sequence number and link to its predecessor are checked,
 * whatever its kind. Then:
 *
 * - Contents present: they must match their recorded digest, where there is
 *   one, and the hash is recomputed, over the digest under scheme 2 or over
 *   the contents under scheme 1. Changing the contents or the digest shows.
 * - Contents erased: a declared `audit.contents_erased` event must name it,
 *   or it counts as tampered. Under scheme 2 its hash is recomputed from the
 *   digest. Under scheme 1, where the original hash needs the contents, its
 *   commitment is checked through the root instead.
 * - The `audit.scheme_changed` event, where a chain moved from scheme 1, must
 *   follow the last scheme 1 event, name it as the old head, and commit to
 *   the root of every scheme 1 event's commitment.
 */
export async function verifyEvents(
  events: StoredEvent[]
): Promise<ChainVerification> {
  const fail = (
    e: StoredEvent,
    reason: Extract<ChainVerification, { ok: false }>['reason']
  ): ChainVerification => ({
    ok: false,
    events: events.length,
    failedAtSeq: e.seq,
    reason
  });
  const byId = new Map(events.map((e) => [e.id, e]));

  let expectedPrev = GENESIS_HASH;
  let expectedSeq = 1;
  let erased = 0;
  let scheme2 = false;
  const commitments: string[] = [];
  let withoutDigest = 0;

  for (const e of events) {
    if (e.seq !== expectedSeq) return fail(e, 'sequence_gap');
    if (e.prevHash !== expectedPrev) return fail(e, 'broken_link');

    const isErased = e.erasedAt !== null;
    if (isErased) {
      const by = e.erasedBy ? byId.get(e.erasedBy) : undefined;
      const seqs = (by?.metadata as { seqs?: unknown } | undefined)?.seqs;
      if (
        !by ||
        by.action !== CONTENTS_ERASED ||
        !Array.isArray(seqs) ||
        !seqs.includes(e.seq) ||
        e.before !== null ||
        e.after !== null ||
        Object.keys(e.metadata).length > 0 ||
        !e.contentDigest
      )
        return fail(e, 'undeclared_erasure');
      erased += 1;
    } else if (
      e.contentDigest &&
      (await contentDigest(e)) !== e.contentDigest
    ) {
      return fail(e, 'digest_mismatch');
    }

    if (e.scheme === 2) {
      if (!e.contentDigest) return fail(e, 'scheme_mismatch');
      const recomputed = await sha256Hex(
        payloadV2({ ...e, contentDigest: e.contentDigest })
      );
      if (recomputed !== e.hash) return fail(e, 'hash_mismatch');
      if (!scheme2 && expectedSeq > 1) {
        // The first scheme 2 event after scheme 1 ones must declare the change.
        const m = e.metadata as {
          oldHeadHash?: string;
          convertedEvents?: number;
          commitmentRoot?: string;
        };
        if (
          e.action !== SCHEME_CHANGED ||
          isErased ||
          withoutDigest > 0 ||
          m.oldHeadHash !== e.prevHash ||
          m.convertedEvents !== commitments.length ||
          m.commitmentRoot !== (await rootOf(commitments))
        )
          return fail(e, 'scheme_mismatch');
      }
      scheme2 = true;
    } else if (e.scheme === 1) {
      if (scheme2) return fail(e, 'scheme_mismatch');
      // An erased scheme 1 event's original hash cannot be recomputed without
      // its contents; its commitment, checked through the root, stands in.
      if (!isErased && (await sha256Hex(payloadV1(e))) !== e.hash)
        return fail(e, 'hash_mismatch');
      if (e.contentDigest)
        commitments.push(
          await commitmentOf({ ...e, contentDigest: e.contentDigest })
        );
      else withoutDigest += 1;
    } else {
      return fail(e, 'scheme_mismatch');
    }

    expectedPrev = e.hash;
    expectedSeq += 1;
  }

  // Old events given digests that no scheme change commits to.
  if (!scheme2 && commitments.length > 0)
    return fail(events[events.length - 1], 'scheme_mismatch');

  return { ok: true, events: events.length, headHash: expectedPrev, erased };
}
