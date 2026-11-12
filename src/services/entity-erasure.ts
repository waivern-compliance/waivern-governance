import { randomBytes } from 'node:crypto';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';

import { db, withOrganisation, type Db } from '@/db/client';
import {
  entities,
  entityErasures,
  organisations,
  users,
  type EntityErasureStatus
} from '@/db/schema';
import { appUrl } from '@/lib/app-url';
import { appendAuditEvent, eraseAuditContents } from '@/lib/audit';
import { sha256Hex } from '@/lib/canonical';
import {
  CONFIRM_PHRASE,
  erasureDoneEmail,
  erasureLinkEmail
} from '@/lib/email/entity-erasure';
import { alertPlatformAdmins } from '@/lib/email/platform-alerts';
import {
  sendEmail,
  transportConfig,
  type Email,
  type SendOutcome
} from '@/lib/email/resend';
import { log } from '@/lib/log';

import { sqlOwners } from './organisation-export';
import type { Actor } from './templates';
import { queueNotification } from './workflow';

/**
 * Deleting a legal entity and every record held for it, for good.
 *
 * Asked for on one page, confirmed from a link emailed to the person who
 * asked, at the address Govern holds for them, and carried out only once they
 * are signed in as themselves and have typed the confirmation. Who may ask is
 * for the caller (`mayDeleteEntity`), and is checked again at the end.
 *
 * Everything happens in one transaction for the entity's organisation, under
 * its row-level security, so it is all deleted or none of it is. The database
 * refuses to let decisions and history go (the append-only guards); the
 * transaction marks its request `erasing` and names it in
 * `govern.entity_erasure`, which those guards accept for this entity's rows
 * only (migration 0113).
 *
 * The audit trail is not cut. Every event about the entity or its records
 * keeps its place, who did what, when and to which record, and has its
 * contents (what changed) erased through `eraseAuditContents`, which keeps
 * their digest, so the organisation's chain still verifies end to end. That
 * erasure is itself an event, and one more records that the entity was
 * deleted, naming only who did it and how many records went.
 *
 * What is kept: the acceptance of the terms and the Data Processing Agreement
 * for the entity, which is Waivern's own record (terms 6.3), detached from it;
 * the organisation's suppliers, templates, workflows and people, which belong
 * to the organisation, not the entity; and this request, which says what was
 * deleted, when and by whom, and nothing of what the records held.
 */

export class ErasureRefused extends Error {}

/** How long the emailed link works. */
export const LINK_MINUTES = 30;

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Send = (email: Email) => Promise<SendOutcome>;

/** Is `typed` the confirmation? Exactly the phrase, ignoring only space around it. */
export function confirms(typed: string): boolean {
  return typed.trim() === CONFIRM_PHRASE;
}

/**
 * Why this entity cannot be deleted as things stand, or nothing.
 *
 * - The organisation's last entity: an organisation with none has nowhere to
 *   put anything. Closing the whole organisation is Waivern's to do (terms
 *   11.2).
 * - The default entity: records that name no entity land there, so another
 *   has to be chosen first, deliberately.
 * - Records in another entity that depend on this one's AI systems: those
 *   records are the other entity's, and cannot be deleted with this one.
 */
export async function erasureBlockers(
  organisationId: string,
  entityId: string
): Promise<string[]> {
  return withOrganisation(organisationId, () =>
    blockers(db as unknown as Tx, organisationId, entityId)
  );
}

async function blockers(
  tx: Tx,
  organisationId: string,
  entityId: string
): Promise<string[]> {
  const all = await tx
    .select({ id: entities.id, isDefault: entities.isDefault })
    .from(entities)
    .where(eq(entities.organisationId, organisationId));
  const entity = all.find((e) => e.id === entityId);
  if (!entity) return ['No such legal entity in this organisation.'];
  const reasons: string[] = [];
  if (all.length === 1)
    reasons.push(
      "It is the organisation's only legal entity. To close the whole organisation, its owner emails info@waivern.com."
    );
  else if (entity.isDefault)
    reasons.push(
      'It is the default entity, where records that name no entity land. Make another entity the default first.'
    );
  const [dependants] = await tx.execute<{ n: number }>(sql`
    select (
      (select count(*) from atrs_record r join ai_use_case u on u.id = r.ai_use_case_id
        where u.entity_id = ${entityId} and r.entity_id <> ${entityId})
      + (select count(*) from ai_change c join ai_use_case u on u.id = c.ai_use_case_id
        where u.entity_id = ${entityId} and c.entity_id <> ${entityId})
      + (select count(*) from ai_assurance_record a join ai_use_case u on u.id = a.ai_use_case_id
        where u.entity_id = ${entityId} and a.entity_id <> ${entityId})
      + (select count(*) from ai_incident i join ai_use_case u on u.id = i.ai_use_case_id
        where u.entity_id = ${entityId} and i.entity_id <> ${entityId})
      + (select count(*) from ai_use_case_request q join ai_use_case u on u.id = q.ai_use_case_id
        where u.entity_id = ${entityId} and q.entity_id <> ${entityId})
    )::int as n`);
  if (Number(dependants?.n ?? 0) > 0)
    reasons.push(
      `${dependants.n} records in other legal entities depend on this entity's AI systems. Those records belong to the other entities and are not deleted with this one; move or remove them first.`
    );
  // Records of other entities that the database would delete with this
  // entity's, because they cite them: a scan finding on this entity's
  // evidence, an extraction finding quoting its document, a sharing agreement
  // naming its processing activity.
  const [cited] = await tx.execute<{ n: number }>(sql`
    select (
      (select count(*) from scan_finding f join evidence e on e.id = f.evidence_id
        where e.entity_id = ${entityId} and f.entity_id <> ${entityId})
      + (select count(*) from extraction_finding f
          join document d on d.id = f.source_document_id
          join extraction x on x.id = f.extraction_id
        where d.entity_id = ${entityId} and x.entity_id <> ${entityId})
      + (select count(*) from sharing_agreement_activity l
          join processing_activity p on p.id = l.activity_id
          join sharing_agreement g on g.id = l.agreement_id
        where p.entity_id = ${entityId} and g.entity_id <> ${entityId})
    )::int as n`);
  if (Number(cited?.n ?? 0) > 0)
    reasons.push(
      `${cited.n} records in other legal entities cite this entity's records (scan findings on its evidence, extraction findings from its documents, or sharing agreements naming its processing activities), and would be deleted with them. Remove those citations from the other entities first.`
    );
  return reasons;
}

/** The deployment's address for links in email, else the request's own. */
function linkBase(origin: string): string {
  return appUrl() || origin.replace(/\/+$/, '');
}

/**
 * The token goes after `#`, which browsers never send to the server, so it
 * stays out of request logs and Referer headers. The page reads it and hands
 * it to a server action in the body of a POST.
 */
export function erasurePath(token: string): string {
  return `/app/admin/organisation/delete-entity/confirm#${token}`;
}

/**
 * Ask to delete an entity: record the request and email its link to the
 * requester's address of record, never to an address given with the request.
 *
 * Asking again for the same entity replaces any earlier link, once the new
 * one has been sent: if it cannot be, the earlier link still works. Requests
 * for one entity take turns on its row, so two at once cannot both leave a
 * live link. Nothing is deleted here.
 */
export async function requestEntityErasure(input: {
  organisationId: string;
  entityId: string;
  userId: string;
  actor: Actor;
  origin: string;
  send?: Send;
}): Promise<{ sentTo: string; expiresAt: Date }> {
  const send: Send =
    input.send ?? ((email) => sendEmail(email, { config: transportConfig() }));
  if (!input.send && !transportConfig() && !devLinks())
    throw new ErasureRefused(
      'This deployment cannot send email, so the deletion cannot be confirmed. Ask whoever runs it to set RESEND_API_KEY and EMAIL_FROM.'
    );

  const token = randomBytes(32).toString('base64url');
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + LINK_MINUTES * 60_000);

  const { entity, email, organisationName, erasureId, replaced } =
    await withOrganisation(input.organisationId, () =>
      db.transaction(async (tx) => {
        const [entity] = await tx
          .select()
          .from(entities)
          .where(
            and(
              eq(entities.id, input.entityId),
              eq(entities.organisationId, input.organisationId)
            )
          )
          .for('update');
        if (!entity)
          throw new ErasureRefused(
            'No such legal entity in this organisation.'
          );
        const reasons = await blockers(
          tx,
          input.organisationId,
          input.entityId
        );
        if (reasons.length) throw new ErasureRefused(reasons.join(' '));

        // The address of record, read from the account rather than taken from
        // anything the request carried.
        const [user] = await db
          .select({ email: users.email })
          .from(users)
          .where(eq(users.id, input.userId));
        if (!user?.email)
          throw new ErasureRefused(
            'There is no email address on record for you.'
          );

        const [org] = await tx
          .select({ name: organisations.name })
          .from(organisations)
          .where(eq(organisations.id, input.organisationId));

        const replaced = await tx
          .update(entityErasures)
          .set({ status: 'superseded' })
          .where(
            and(
              eq(entityErasures.organisationId, input.organisationId),
              eq(entityErasures.entityId, input.entityId),
              eq(entityErasures.status, 'requested')
            )
          )
          .returning({ id: entityErasures.id });
        const [erasure] = await tx
          .insert(entityErasures)
          .values({
            organisationId: input.organisationId,
            entityId: entity.id,
            entityName: entity.name,
            legalEntityRef: entity.legalEntityRef,
            tokenHash,
            expiresAt,
            requestedBy: input.userId,
            requestedByEmail: user.email
          })
          .returning();
        await appendAuditEvent(tx, {
          ...input.actor,
          organisationId: input.organisationId,
          action: 'entity.deletion_requested',
          subjectType: 'entity',
          subjectId: entity.id,
          entityId: entity.id,
          after: { erasureId: erasure.id, expiresAt: expiresAt.toISOString() }
        });
        return {
          entity,
          email: user.email,
          organisationName: org.name,
          erasureId: erasure.id,
          replaced: replaced.map((r) => r.id)
        };
      })
    );

  const url = `${linkBase(input.origin)}${erasurePath(token)}`;
  const message = erasureLinkEmail({
    entityName: entity.name,
    organisationName,
    url,
    expiresAt
  });
  if (!input.send && !transportConfig()) {
    // Development only (`devLinks`): there is no mail to send it with.
    console.info(`[entity-erasure] confirmation link for ${email}: ${url}`);
  } else {
    const outcome = await send({ ...message, to: [email] });
    if (!outcome.sent) {
      await withdrawRequest(input.organisationId, erasureId, replaced);
      throw new ErasureRefused(
        'The confirmation email could not be sent, so nothing will be deleted. Try again in a few minutes.'
      );
    }
  }
  return { sentTo: email, expiresAt };
}

/**
 * The new link never reached anyone: retire it, and give back the links it
 * replaced, unless a later request has replaced them since.
 */
async function withdrawRequest(
  organisationId: string,
  erasureId: string,
  replaced: string[]
) {
  await withOrganisation(organisationId, () =>
    db.transaction(async (tx) => {
      const [mine] = await tx
        .update(entityErasures)
        .set({ status: 'superseded' })
        .where(
          and(
            eq(entityErasures.id, erasureId),
            eq(entityErasures.status, 'requested')
          )
        )
        .returning({ entityId: entityErasures.entityId });
      if (!mine || replaced.length === 0) return;
      await tx.execute(sql`
        update entity_erasure set status = 'requested'
        where id = any(${uuids(replaced)}) and status = 'superseded'
          and not exists (select 1 from entity_erasure o
            where o.entity_id = ${mine.entityId} and o.status = 'requested')`);
    })
  );
}

/** Local development with sign-in by email alone: links are printed, not sent. */
function devLinks(): boolean {
  return (
    process.env.ALLOW_DEV_SIGN_IN === 'true' &&
    process.env.NODE_ENV !== 'production'
  );
}

export type ErasureLink =
  | { state: 'not_found' }
  | {
      state: 'expired' | 'used' | 'open';
      erasure: typeof entityErasures.$inferSelect;
    };

/**
 * The request a link is for, and whether it can still be used.
 *
 * Looked up by the token's hash, before anyone knows which organisation it is
 * in, as a contributor link is.
 */
export async function erasureForToken(token: string): Promise<ErasureLink> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return { state: 'not_found' };
  const [erasure] = await db
    .select()
    .from(entityErasures)
    .where(eq(entityErasures.tokenHash, await sha256Hex(token)));
  if (!erasure) return { state: 'not_found' };
  if (erasure.status !== 'requested') return { state: 'used', erasure };
  if (erasure.expiresAt.getTime() <= Date.now())
    return { state: 'expired', erasure };
  return { state: 'open', erasure };
}

export type ErasureView =
  | { state: 'not_found' | 'expired' | 'used' }
  | { state: 'refused'; message: string }
  | {
      state: 'open';
      entityName: string;
      legalEntityRef: string | null;
      records: number;
    };

/**
 * What the confirmation page shows for a link: whether it can be used, and,
 * only once `check` has let this person see it, what deleting would take.
 * `check` answers with the reason they may not, or null.
 */
export async function openEntityErasure(
  token: string,
  check: (erasure: typeof entityErasures.$inferSelect) => Promise<string | null>
): Promise<ErasureView> {
  const link = await erasureForToken(token);
  if (link.state !== 'open') return { state: link.state };
  const refused = await check(link.erasure);
  if (refused) return { state: 'refused', message: refused };
  const { records } = await previewErasure(
    link.erasure.organisationId,
    link.erasure.entityId
  );
  return {
    state: 'open',
    entityName: link.erasure.entityName,
    legalEntityRef: link.erasure.legalEntityRef,
    records
  };
}

/**
 * A completed deletion, if this person asked for it: what the page tells them
 * once it is done, whether or not they may still delete anything.
 */
export async function deletionBy(
  organisationId: string,
  erasureId: string,
  userId: string
): Promise<{ entityName: string } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(erasureId)) return null;
  const [row] = await withOrganisation(organisationId, () =>
    db
      .select({ entityName: entityErasures.entityName })
      .from(entityErasures)
      .where(
        and(
          eq(entityErasures.id, erasureId),
          eq(entityErasures.organisationId, organisationId),
          eq(entityErasures.requestedBy, userId),
          eq(entityErasures.status, 'completed' satisfies EntityErasureStatus)
        )
      )
  );
  return row ?? null;
}

/** Entities this organisation has deleted, newest first. */
export async function deletedEntities(organisationId: string) {
  return withOrganisation(organisationId, () =>
    db
      .select({
        id: entityErasures.id,
        entityName: entityErasures.entityName,
        legalEntityRef: entityErasures.legalEntityRef,
        requestedByEmail: entityErasures.requestedByEmail,
        completedAt: entityErasures.completedAt,
        counts: entityErasures.counts,
        auditErased: entityErasures.auditErased
      })
      .from(entityErasures)
      .where(
        and(
          eq(entityErasures.organisationId, organisationId),
          eq(entityErasures.status, 'completed' satisfies EntityErasureStatus)
        )
      )
      .orderBy(desc(entityErasures.completedAt))
  );
}

/**
 * Carry out a deletion from its link.
 *
 * The caller has checked, again, that this person may delete the entity. Here
 * the link must be open, theirs, and confirmed with the exact words.
 */
export async function confirmEntityErasure(input: {
  token: string;
  userId: string;
  typed: string;
  actor: Actor;
  /**
   * Checks, once the link says which entity it is for, that this person may
   * still delete it; throws if not.
   */
  authorise?: (target: {
    organisationId: string;
    entityId: string;
  }) => Promise<unknown>;
  send?: Send;
}): Promise<{
  erasureId: string;
  entityName: string;
  records: number;
  auditErased: number;
  /** Whether the written confirmation was sent. */
  confirmationSent: boolean;
}> {
  if (!confirms(input.typed))
    throw new ErasureRefused(
      `Type "${CONFIRM_PHRASE}" exactly to confirm. Nothing has been deleted.`
    );
  const link = await erasureForToken(input.token);
  if (link.state === 'not_found')
    throw new ErasureRefused(
      'This link is not valid. Nothing has been deleted.'
    );
  if (link.state === 'used')
    throw new ErasureRefused('This link has already been used or replaced.');
  if (link.state === 'expired')
    throw new ErasureRefused(
      'This link has expired. Nothing has been deleted. Ask again if you still want to.'
    );
  if (link.erasure.requestedBy !== input.userId)
    throw new ErasureRefused(
      'This link was sent to somebody else. Only the person who asked can confirm it.'
    );
  await input.authorise?.({
    organisationId: link.erasure.organisationId,
    entityId: link.erasure.entityId
  });

  const result = await eraseEntity(
    link.erasure.id,
    link.erasure.organisationId,
    input.actor
  );

  const send: Send =
    input.send ?? ((email) => sendEmail(email, { config: transportConfig() }));
  const done = erasureDoneEmail({
    entityName: result.entityName,
    organisationName: result.organisationName,
    deletedBy: input.actor.actorLabel,
    records: result.records,
    completedAt: result.completedAt
  });
  // After the commit, and never fatal: the deletion has happened whatever the
  // mail does. The requester gets written confirmation (DPA clause 5(h)); the
  // platform's operators get a record outside the database, so a whole-service
  // restore from an older backup can be followed by deleting it again.
  const confirmation = await send({
    ...done,
    to: [link.erasure.requestedByEmail]
  });
  await alertPlatformAdmins({
    ...done,
    subject: `Legal entity deleted: ${result.entityName} (${result.organisationName})`,
    text: `${done.text}\n\nOrganisation id: ${link.erasure.organisationId}\nEntity id: ${link.erasure.entityId}\nIf the service is restored from a backup taken before ${result.completedAt.toISOString()}, delete this entity again.`
  });
  log('info', 'entity_erasure.completed', {
    records: result.records,
    auditErased: result.auditErased
  });
  return {
    erasureId: link.erasure.id,
    entityName: result.entityName,
    records: result.records,
    auditErased: result.auditErased,
    confirmationSent: confirmation.sent
  };
}

/**
 * Entity-level tables, deleted by `entity_id`, in an order that lets every
 * foreign key and append-only guard through: a row before whatever it refers
 * to with `restrict`. Their own children follow by cascade.
 *
 * `tests/entity-erasure.test.ts` checks this against the database: every
 * table with an `entity_id` is here or in KEPT_WITH_ENTITY_ID.
 */
export const ERASED_BY_ENTITY = [
  'ai_assurance_record',
  'ai_change',
  'atrs_record',
  'ai_incident',
  'ai_use_case_request',
  'ai_use_case',
  'extraction',
  'risk',
  'assessment',
  'breach',
  'data_protection_complaint',
  'information_request',
  'data_subject_request',
  'dsr_intake_link',
  'digital_property',
  'marketing_activity',
  'sharing_agreement',
  'processing_activity',
  'scan_finding',
  'evidence',
  'document',
  'policy_document',
  'import_batch',
  'schedule',
  'task',
  'comment',
  'ai_conversation'
] as const;

/** Tables with an `entity_id` that are not deleted by it, and why. */
export const KEPT_WITH_ENTITY_ID: Record<string, string> = {
  audit_event:
    'Kept, with what changed erased and its digest kept, so the chain still verifies (eraseAuditContents).',
  entity_agreement:
    "Waivern's own record of the terms and DPA accepted; detached from the entity.",
  retention_profile: 'Deleted with the entity, by cascade.',
  role_assignment: 'Deleted with the entity, by cascade.',
  entity_erasure: 'The record that the entity was deleted, by whom and when.'
};

/**
 * Rows with no entity of their own that hang off a record by subject: a
 * comment or document on it, a conversation about it. Deleted with it.
 */
const ATTACHED_BY_SUBJECT = [
  'comment',
  'document',
  'extraction',
  'ai_conversation'
] as const;

const UUID_PATTERN =
  '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';

/** A list of ids as one parameter, however many there are. */
function uuids(ids: readonly string[]): SQL {
  return sql`string_to_array(${ids.join(',')}, ',')::uuid[]`;
}

async function ids(tx: Tx, query: SQL): Promise<string[]> {
  const rows = await tx.execute<{ id: string }>(query);
  return rows.map((r) => r.id);
}

/**
 * Every row that will go, by table: the entity's own, what is attached to
 * them by subject, and every child that follows by cascade. Read before
 * anything is deleted, for the counts and for finding the audit events about
 * them.
 */
async function gather(tx: Tx, entityId: string) {
  const byTable = new Map<string, Set<string>>();
  const add = (table: string, found: string[]) => {
    const set = byTable.get(table) ?? new Set<string>();
    for (const id of found) set.add(id);
    byTable.set(table, set);
  };
  const all = () => [entityId, ...[...byTable.values()].flatMap((s) => [...s])];

  for (const table of ERASED_BY_ENTITY)
    add(
      table,
      await ids(
        tx,
        sql`select id from ${sql.identifier(table)} where entity_id = ${entityId}`
      )
    );

  // Attached by subject, to a record of the entity or to the entity itself,
  // and not already another entity's. Twice, for a comment on a document on
  // a record.
  for (let pass = 0; pass < 2; pass++) {
    const known = all();
    for (const table of ATTACHED_BY_SUBJECT)
      add(
        table,
        await ids(
          tx,
          sql`select id from ${sql.identifier(table)}
              where entity_id is null and subject_id = any(${uuids(known)})`
        )
      );
  }
  add(
    'ai_suggestion',
    await ids(
      tx,
      sql`select id from ai_suggestion
          where subject_id = any(${uuids(all())})
             or conversation_id = any(${uuids([...(byTable.get('ai_conversation') ?? [])])})`
    )
  );

  // Children that go by cascade, found from the database's own foreign keys
  // so a table added later is counted without anyone remembering to.
  const fks = await tx.execute<{
    child: string;
    parent: string;
    col: string;
  }>(sql`
    select c.conrelid::regclass::text as child,
           c.confrelid::regclass::text as parent,
           a.attname as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confdeltype = 'c' and array_length(c.conkey, 1) = 1
      and exists (select 1 from pg_attribute i where i.attrelid = c.conrelid
                  and i.attname = 'id' and not i.attisdropped)`);
  // Each round asks only about the rows the last round found, so it stops
  // as soon as a round finds nothing new.
  let fresh = new Map(
    [...byTable].map(([table, set]) => [table, [...set]] as const)
  );
  while (fresh.size > 0) {
    const next = new Map<string, string[]>();
    for (const fk of fks) {
      if (fk.parent === 'entity' || fk.parent === 'organisation') continue;
      const parents = fresh.get(fk.parent);
      if (!parents?.length) continue;
      const known = byTable.get(fk.child) ?? new Set<string>();
      const found = (
        await ids(
          tx,
          sql`select id from ${sql.identifier(fk.child)}
              where ${sql.identifier(fk.col)} = any(${uuids(parents)})`
        )
      ).filter((id) => !known.has(id));
      if (found.length === 0) continue;
      add(fk.child, found);
      next.set(fk.child, [...(next.get(fk.child) ?? []), ...found]);
    }
    fresh = next;
  }
  return { byTable, all: all() };
}

/**
 * How many records deleting the entity would take, by table, for the page
 * that confirms it: what will go, read the same way the deletion reads it.
 */
export async function previewErasure(
  organisationId: string,
  entityId: string
): Promise<{ records: number; byTable: Record<string, number> }> {
  return withOrganisation(organisationId, async () => {
    const { byTable } = await gather(db as unknown as Tx, entityId);
    const counts = countsOf(byTable);
    return {
      records: Object.values(counts).reduce((s, n) => s + n, 0),
      byTable: counts
    };
  });
}

function countsOf(byTable: Map<string, Set<string>>): Record<string, number> {
  return Object.fromEntries(
    [...byTable.entries()]
      .filter(([, set]) => set.size > 0)
      .map(([table, set]) => [table, set.size] as const)
      .sort(([a], [b]) => a.localeCompare(b))
  );
}

async function eraseEntity(
  erasureId: string,
  organisationId: string,
  actor: Actor
) {
  return withOrganisation(organisationId, () =>
    db.transaction(async (tx) => {
      const [erasure] = await tx
        .select()
        .from(entityErasures)
        .where(eq(entityErasures.id, erasureId))
        .for('update');
      if (!erasure || erasure.status !== 'requested')
        throw new ErasureRefused(
          'This link has already been used or replaced.'
        );
      if (erasure.expiresAt.getTime() <= Date.now())
        throw new ErasureRefused(
          'This link has expired. Nothing has been deleted. Ask again if you still want to.'
        );
      const entityId = erasure.entityId;

      // Anything writing to the entity waits for this, then fails on its
      // foreign key once the entity is gone: nothing half-written survives.
      const [entity] = await tx
        .select()
        .from(entities)
        .where(eq(entities.id, entityId))
        .for('update');
      if (!entity)
        throw new ErasureRefused('That legal entity no longer exists.');
      const reasons = await blockers(tx, organisationId, entityId);
      if (reasons.length) throw new ErasureRefused(reasons.join(' '));
      const [org] = await tx
        .select({ name: organisations.name })
        .from(organisations)
        .where(eq(organisations.id, organisationId));

      await tx
        .update(entityErasures)
        .set({ status: 'erasing' })
        .where(eq(entityErasures.id, erasureId));
      await tx.execute(
        sql`select set_config('govern.entity_erasure', ${erasureId}, true)`
      );

      const { byTable, all } = await gather(tx, entityId);
      const list = (table: string) => [...(byTable.get(table) ?? [])];
      const remove = (table: string, where: SQL) =>
        tx.execute(sql`delete from ${sql.identifier(table)} where ${where}`);

      // Children the append-only guards protect, and anything another
      // entity's record holds with `restrict`, before what they point at.
      await remove(
        'ai_incident_event',
        sql`incident_id = any(${uuids(list('ai_incident'))})`
      );
      await remove(
        'assessment_revision',
        sql`assessment_id = any(${uuids(list('assessment'))})`
      );
      await remove(
        'risk_acceptance',
        sql`risk_id = any(${uuids(list('risk'))})`
      );
      await remove(
        'extraction_finding',
        sql`source_document_id = any(${uuids(list('document'))})`
      );
      await remove(
        'ai_suggestion',
        sql`id = any(${uuids(list('ai_suggestion'))})`
      );
      for (const table of ERASED_BY_ENTITY)
        await remove(table, sql`entity_id = ${entityId}`);
      for (const table of ATTACHED_BY_SUBJECT)
        await remove(table, sql`id = any(${uuids(list(table))})`);

      // Every id that has gone, indexed, for the matches below: each row is
      // looked up in it, rather than compared with every id in turn.
      await tx.execute(sql`
        create temporary table erased_id (id uuid primary key) on commit drop`);
      await tx.execute(sql`
        insert into erased_id select distinct unnest(${uuids(all)})`);
      const gone = (column: SQL) =>
        sql`${column} in (select id from erased_id)`;

      // Links, queued email and webhook deliveries that name what has gone:
      // any id written in the key or the payload.
      await remove(
        'record_link',
        sql`organisation_id = ${organisationId}
            and (${gone(sql`from_id`)} or ${gone(sql`to_id`)})`
      );
      const named = (column: SQL) => sql`exists (
        select 1 from regexp_matches(${column}, ${UUID_PATTERN}, 'g') as m
        where ${gone(sql`m[1]::uuid`)})`;
      await remove(
        'notification',
        sql`organisation_id = ${organisationId} and ${named(sql`idempotency_key`)}`
      );
      await remove(
        'webhook_delivery',
        sql`organisation_id = ${organisationId}
            and (${named(sql`idempotency_key`)} or ${named(sql`payload::text`)})`
      );

      // A connection whose records landed here stops until somebody chooses
      // where they go now, rather than quietly sending them to the default.
      const stopped = await tx.execute<{ id: string }>(sql`
        update integration_connection
        set is_active = false, default_entity_id = null
        where default_entity_id = ${entityId}
        returning id`);

      await tx.execute(
        sql`update entity_agreement set entity_id = null where entity_id = ${entityId}`
      );

      // What changed, in every event about the entity or its records: gone,
      // with the records. Who did what, when and to which record stays, and
      // the digest of what changed, so the chain still verifies.
      const about = await ids(
        tx,
        sql`select id from audit_event
            where organisation_id = ${organisationId}
              and (entity_id = ${entityId} or ${gone(sql`subject_id`)})`
      );
      const { erased: auditErased } = await eraseAuditContents(tx, {
        organisationId,
        eventIds: about,
        reason: 'The legal entity these events describe was deleted.',
        actor,
        subject: { subjectType: 'entity', subjectId: entityId }
      });

      await tx.delete(entities).where(eq(entities.id, entityId));

      const counts = countsOf(byTable);
      const records = Object.values(counts).reduce((s, n) => s + n, 0);
      const completedAt = new Date();
      await tx
        .update(entityErasures)
        .set({
          status: 'completed',
          completedAt,
          counts,
          auditErased
        })
        .where(eq(entityErasures.id, erasureId));
      await tx.execute(
        sql`select set_config('govern.entity_erasure', '', true)`
      );

      // Names nobody but the person who did it, and nothing the records held.
      const event = await appendAuditEvent(tx, {
        ...actor,
        organisationId,
        action: 'entity.deleted',
        subjectType: 'entity',
        subjectId: entityId,
        entityId: null,
        after: {
          erasureId,
          records,
          auditEventsErased: auditErased,
          connectionsStopped: stopped.length
        }
      });

      const owners = await tx.execute<{ email: string }>(
        sqlOwners({ organisationId })
      );
      for (const owner of owners) {
        if (owner.email.toLowerCase() === actor.actorLabel.toLowerCase())
          continue;
        await queueNotification(tx, {
          organisationId,
          recipient: owner.email,
          kind: 'entity.deleted',
          subject: `${actor.actorLabel} deleted the legal entity ${entity.name}`,
          body: [
            `${actor.actorLabel} deleted ${entity.name} and every record held for it: ${records} records. This cannot be undone.`,
            'If you did not expect this, ask them about it, and check the activity log.',
            '/app/admin/organisation/delete-entity'
          ].join('\n'),
          idempotencyKey: `entity-deleted:${event.hash}:${owner.email}`
        });
      }

      return {
        entityName: entity.name,
        organisationName: org.name,
        records,
        auditErased,
        completedAt
      };
    })
  );
}
