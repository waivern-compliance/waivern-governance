import { and, desc, eq, inArray, like, sql } from 'drizzle-orm';

import { db, withOrganisation } from '@/db/client';
import {
  entities,
  memberships,
  organisationRequests,
  organisations,
  retentionProfiles,
  roleAssignments,
  slaPolicies,
  users
} from '@/db/schema';
import { appendAuditEvent } from '@/lib/audit';
import { isEmailAddress } from '@/lib/email-address';
import { RETENTION_DEFAULTS, slugFor } from '@/lib/organisation/defaults';
import { DEFAULT_SLA } from '@/lib/workflow/defaults';

import { installShippedWorkflows } from './approval-routing';
import { installShippedTemplates } from './templates';

/**
 * Requests for new organisations, and creating one when a request is approved.
 *
 * All of this is the platform's: a request belongs to no organisation, and
 * the one it creates does not exist until approval. Each new organisation is
 * set up inside its own scope, under its row-level security, through the same
 * installers an existing organisation uses.
 */

export class RequestRefused extends Error {}

const NAME_LIMIT = 120;

function cleanName(value: string, what: string): string {
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name) throw new RequestRefused(`Give the ${what}.`);
  if (name.length > NAME_LIMIT)
    throw new RequestRefused(`The ${what} is too long.`);
  return name;
}

export async function requestOrganisation(input: {
  userId: string;
  email: string;
  organisationName: string;
  entityName: string;
  note?: string;
}) {
  const organisationName = cleanName(
    input.organisationName,
    "organisation's name"
  );
  const entityName = cleanName(
    input.entityName || organisationName,
    "legal entity's name"
  );
  const [pending] = await db
    .select({ id: organisationRequests.id })
    .from(organisationRequests)
    .where(
      and(
        eq(organisationRequests.requestedBy, input.userId),
        eq(organisationRequests.status, 'pending')
      )
    );
  if (pending)
    throw new RequestRefused(
      'You already have a request waiting. It will be looked at soon.'
    );

  const [row] = await db
    .insert(organisationRequests)
    .values({
      requestedBy: input.userId,
      requestedByEmail: input.email.toLowerCase(),
      organisationName,
      entityName,
      note: input.note?.trim().slice(0, 2000) || null
    })
    .returning();
  return row;
}

/** A person's own requests, newest first. */
export async function requestsBy(userId: string) {
  return db
    .select()
    .from(organisationRequests)
    .where(eq(organisationRequests.requestedBy, userId))
    .orderBy(desc(organisationRequests.createdAt))
    .limit(5);
}

/** For Waivern's operators: what is waiting, then what was decided lately. */
export async function requestQueue() {
  const [pending, decided] = await Promise.all([
    db
      .select()
      .from(organisationRequests)
      .where(eq(organisationRequests.status, 'pending'))
      .orderBy(organisationRequests.createdAt),
    db
      .select()
      .from(organisationRequests)
      .where(inArray(organisationRequests.status, ['approved', 'declined']))
      .orderBy(desc(organisationRequests.decidedAt))
      .limit(20)
  ]);
  return { pending, decided };
}

async function pendingRequest(requestId: string) {
  const [request] = await db
    .select()
    .from(organisationRequests)
    .where(eq(organisationRequests.id, requestId));
  if (!request) throw new RequestRefused('No such request.');
  if (request.status !== 'pending')
    throw new RequestRefused(
      `That request has already been ${request.status}.`
    );
  return request;
}

/** A slug nobody has: the name's, or the name's with a number after it. */
async function freeSlug(name: string): Promise<string> {
  const base = slugFor(name);
  const taken = new Set(
    (
      await db
        .select({ slug: organisations.slug })
        .from(organisations)
        .where(like(organisations.slug, `${base}%`))
    ).map((r) => r.slug)
  );
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

/**
 * Create an organisation, its first legal entity, its owner, and everything an
 * organisation starts with: the shipped templates and workflows, service
 * levels and retention defaults. The owner is a person by id, or by email for
 * somebody who may not have signed in yet; an account is made for them, as an
 * invitation makes one.
 *
 * If any of it fails the organisation is removed again, so a half-built one
 * never appears in anybody's switcher.
 */
async function setUpOrganisation(input: {
  organisationName: string;
  entityName: string;
  owner: { id: string; email: string } | { email: string };
  actor: { actorKind: 'user'; actorUserId: null; actorLabel: string };
  /** What the audit records about how it came about. */
  origin: Record<string, unknown>;
}) {
  const { actor } = input;
  const [org] = await db
    .insert(organisations)
    .values({
      name: input.organisationName,
      slug: await freeSlug(input.organisationName)
    })
    .returning();

  let ownerId = 'id' in input.owner ? input.owner.id : '';
  // An account made here for an owner who had none, removed again with the
  // organisation if setting it up fails.
  let madeAccount = false;
  try {
    await withOrganisation(org.id, async () => {
      await db.transaction(async (tx) => {
        await appendAuditEvent(tx, {
          ...actor,
          organisationId: org.id,
          action: 'organisation.created',
          subjectType: 'organisation',
          subjectId: org.id,
          after: { name: org.name, slug: org.slug, ...input.origin }
        });
        const [entity] = await tx
          .insert(entities)
          .values({
            organisationId: org.id,
            name: input.entityName,
            isDefault: true
          })
          .returning();
        await appendAuditEvent(tx, {
          ...actor,
          organisationId: org.id,
          action: 'entity.created',
          subjectType: 'entity',
          subjectId: entity.id,
          entityId: entity.id,
          after: { name: entity.name }
        });
        for (const r of RETENTION_DEFAULTS) {
          await tx.insert(retentionProfiles).values({
            organisationId: org.id,
            subjectType: r.subjectType,
            retentionMonths: r.months,
            basis: r.basis
          });
        }
        for (const s of DEFAULT_SLA) {
          await tx.insert(slaPolicies).values({
            organisationId: org.id,
            taskType: s.taskType as 'approve_stage',
            targetHours: s.targetHours,
            escalateToRole: s.escalateToRole
          });
        }
        if (!('id' in input.owner)) {
          // People are shared across organisations; whether this one has an
          // account is answered by id alone, as an invitation asks it.
          const [found] = (await tx.execute(
            sql`select app_user_id_for_email(${input.owner.email}) as id`
          )) as unknown as Array<{ id: string | null }>;
          ownerId = found?.id ?? crypto.randomUUID();
          // No `returning`: until the membership below exists, this
          // organisation cannot see the person it has just created.
          if (!found?.id) {
            await tx
              .insert(users)
              .values({ id: ownerId, email: input.owner.email });
            madeAccount = true;
          }
        }
        const [membership] = await tx
          .insert(memberships)
          .values({ organisationId: org.id, userId: ownerId })
          .returning();
        const [grant] = await tx
          .insert(roleAssignments)
          .values({
            membershipId: membership.id,
            role: 'owner',
            scope: 'organisation'
          })
          .returning();
        await appendAuditEvent(tx, {
          ...actor,
          organisationId: org.id,
          action: 'role_assignment.granted',
          subjectType: 'role_assignment',
          subjectId: grant.id,
          after: {
            email: input.owner.email,
            role: 'owner',
            scope: 'organisation'
          }
        });
      });
      await installShippedTemplates({ organisationId: org.id, actor });
      await installShippedWorkflows({ organisationId: org.id, actor });
    });
  } catch (error) {
    // Nothing of it may survive: no organisation, entity or membership, and
    // no account made for its owner, who would otherwise sign in to nothing.
    await db.delete(organisations).where(eq(organisations.id, org.id));
    if (madeAccount) await db.delete(users).where(eq(users.id, ownerId));
    throw error;
  }
  return { org, ownerId };
}

const operatorActor = (email: string) => ({
  actorKind: 'user' as const,
  actorUserId: null,
  actorLabel: `Waivern: ${email.trim().toLowerCase()}`
});

/**
 * Approve a request: set the organisation up with the requester as its owner.
 * If that fails, the request stays pending.
 */
export async function approveRequest(input: {
  requestId: string;
  decidedByEmail: string;
}) {
  const request = await pendingRequest(input.requestId);
  const { org } = await setUpOrganisation({
    organisationName: request.organisationName,
    entityName: request.entityName,
    owner: { id: request.requestedBy, email: request.requestedByEmail },
    actor: operatorActor(input.decidedByEmail),
    origin: { requestedBy: request.requestedByEmail }
  });

  const [decided] = await db
    .update(organisationRequests)
    .set({
      status: 'approved',
      decidedByEmail: input.decidedByEmail.toLowerCase(),
      decidedAt: new Date(),
      createdOrganisationId: org.id
    })
    .where(eq(organisationRequests.id, request.id))
    .returning();
  return { request: decided, organisation: org };
}

/**
 * Create an organisation directly, for a Waivern operator setting up a client
 * or one of their own, with no request first. The owner is whoever is named:
 * the operator, or the client's contact, who becomes owner on first sign-in
 * and accepts the terms then, as any owner does.
 */
export async function createOrganisation(input: {
  organisationName: string;
  entityName: string;
  ownerEmail: string;
  createdByEmail: string;
  /** Create it even though an organisation of that name exists. */
  sameNameConfirmed?: boolean;
}) {
  const organisationName = cleanName(
    input.organisationName,
    "organisation's name"
  );
  const entityName = cleanName(
    input.entityName || organisationName,
    "legal entity's name"
  );
  const ownerEmail = input.ownerEmail.trim().toLowerCase();
  if (!isEmailAddress(ownerEmail))
    throw new RequestRefused("Give the owner's email address.");
  // A second submission, after a reload or a slow response, would otherwise
  // make a second organisation of the same name.
  if (!input.sameNameConfirmed) {
    const [same] = await db
      .select({ id: organisations.id })
      .from(organisations)
      .where(sql`lower(${organisations.name}) = lower(${organisationName})`)
      .limit(1);
    if (same)
      throw new RequestRefused(
        `An organisation called ${organisationName} already exists. If this is another one, tick "Create it even so" and create it again.`
      );
  }
  const createdBy = input.createdByEmail.trim().toLowerCase();
  const { org, ownerId } = await setUpOrganisation({
    organisationName,
    entityName,
    owner: { email: ownerEmail },
    actor: operatorActor(createdBy),
    origin: { createdDirectly: true, owner: ownerEmail }
  });
  // Kept with the requests, so the platform page lists it with the rest:
  // who set up which organisation, when, and for whom.
  await db.insert(organisationRequests).values({
    requestedBy: ownerId,
    requestedByEmail: ownerEmail,
    organisationName,
    entityName,
    status: 'approved',
    decidedByEmail: createdBy,
    decidedAt: new Date(),
    decisionNote: DIRECT,
    createdOrganisationId: org.id
  });
  return org;
}

/** How a directly created organisation is marked among the requests. */
export const DIRECT = 'Created directly on the platform page.';

export async function declineRequest(input: {
  requestId: string;
  decidedByEmail: string;
  note: string;
}) {
  const note = input.note.trim();
  if (!note)
    throw new RequestRefused(
      'Say why, so the person asking knows what to do next.'
    );
  const request = await pendingRequest(input.requestId);
  const [decided] = await db
    .update(organisationRequests)
    .set({
      status: 'declined',
      decidedByEmail: input.decidedByEmail.toLowerCase(),
      decidedAt: new Date(),
      decisionNote: note.slice(0, 2000)
    })
    .where(eq(organisationRequests.id, request.id))
    .returning();
  return decided;
}
