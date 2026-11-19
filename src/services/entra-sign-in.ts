import { and, eq, isNull } from 'drizzle-orm';

import { db, withOrganisation } from '@/db/client';
import { memberships, organisationEntraTenants, users } from '@/db/schema';
import { appendAuditEvent } from '@/lib/audit';
import {
  domainOwnerVerified,
  ENTRA_PROVIDER,
  entraSubject,
  type EntraClaims
} from '@/lib/auth/entra';

import { joinByVerifiedDomain } from './domains';
import { joinByTrustedTenant, tenantVouchesFor } from './entra-tenants';

/**
 * Who a Microsoft sign-in is, under a multi-tenant registration.
 *
 * Anybody can create a Microsoft directory and give its users any address, so
 * the address alone never decides who somebody is. A person is bound to one
 * Microsoft account, by tenant and object id, the first time they sign in, and
 * matched by that binding ever after. The first sign-in may match an address
 * only when the address is proved: Microsoft says the directory owns its domain
 * (`xms_edov`), or the domain is one an organisation has verified and trusts
 * this tenant through. A Microsoft account that was signing in here before the
 * registration became multi-tenant is recognised by its old subject.
 *
 * Runs on the owner's connection, as sign-in does: nobody is acting for an
 * organisation yet.
 */

export type EntraRefusal =
  | 'no_email'
  | 'address_not_proved'
  | 'bound_elsewhere'
  | 'not_a_person'
  | 'no_account';

export type EntraSignIn =
  | {
      outcome: 'signed_in';
      userId: string;
      member: boolean;
      /** Whether the address is proved, so they may ask for an organisation. */
      addressProved: boolean;
    }
  | { outcome: 'refused'; reason: EntraRefusal };

const REFUSAL_TEXT: Record<EntraRefusal, string> = {
  no_email: 'the token carries no email address',
  address_not_proved:
    'neither Microsoft nor a trusted tenant vouches for the address, so it cannot be matched to an invitation',
  bound_elsewhere: 'the address belongs to a different Microsoft account',
  not_a_person: 'the address is a simulated colleague',
  no_account: 'nobody has that address and nothing lets them in'
};

export const describeRefusal = (reason: EntraRefusal) => REFUSAL_TEXT[reason];

export async function userForEntraSubject(subject: string) {
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.entraSubject, subject));
  return row ?? null;
}

async function userByEmail(email: string) {
  const [row] = await db.select().from(users).where(eq(users.email, email));
  return row ?? null;
}

async function isMember(userId: string) {
  const [row] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.isActive, true)))
    .limit(1);
  return Boolean(row);
}

/**
 * Tell each organisation the person belongs to that somebody tried to sign in
 * as them. Somebody else's directory claiming a member's address is exactly
 * what an owner needs to see.
 */
async function recordRefusal(
  user: { id: string; email: string },
  claims: EntraClaims,
  reason: EntraRefusal
) {
  const rows = await db
    .select({ organisationId: memberships.organisationId })
    .from(memberships)
    .where(
      and(eq(memberships.userId, user.id), eq(memberships.isActive, true))
    );
  for (const { organisationId } of rows) {
    await withOrganisation(organisationId, () =>
      db.transaction((tx) =>
        appendAuditEvent(tx, {
          actorKind: 'system',
          actorUserId: null,
          actorLabel: 'sign-in',
          organisationId,
          action: 'user.sign_in_refused',
          subjectType: 'user',
          subjectId: user.id,
          after: {
            email: user.email,
            provider: ENTRA_PROVIDER,
            tenantId: claims.tid,
            objectId: claims.oid,
            reason
          }
        })
      )
    );
  }
}

/**
 * Let a person bind a new Microsoft account, after theirs was replaced. The
 * deployment operator's to do, never an organisation owner's: people are
 * shared between organisations, so one owner releasing a binding would expose
 * the person's other organisations. Recorded in each organisation they belong
 * to. Returns the binding released, or null if there was none.
 */
export async function releaseEntraBinding(
  email: string,
  operator: string
): Promise<string | null> {
  const address = email.trim().toLowerCase();
  const person = await userByEmail(address);
  if (!person?.entraSubject) return null;
  const released = person.entraSubject;
  await db
    .update(users)
    .set({ entraSubject: null })
    .where(eq(users.id, person.id));
  const rows = await db
    .select({ organisationId: memberships.organisationId })
    .from(memberships)
    .where(
      and(eq(memberships.userId, person.id), eq(memberships.isActive, true))
    );
  for (const { organisationId } of rows) {
    await withOrganisation(organisationId, () =>
      db.transaction((tx) =>
        appendAuditEvent(tx, {
          actorKind: 'system',
          actorUserId: null,
          actorLabel: operator,
          organisationId,
          action: 'user.entra_binding_released',
          subjectType: 'user',
          subjectId: person.id,
          before: { email: address, entraSubject: released }
        })
      )
    );
  }
  return released;
}

async function tenantTrusted(tenantId: string) {
  const [row] = await db
    .select({ id: organisationEntraTenants.id })
    .from(organisationEntraTenants)
    .where(eq(organisationEntraTenants.tenantId, tenantId))
    .limit(1);
  return Boolean(row);
}

/** Joining is a convenience: a failure is logged and sign-in carries on. */
async function joinWhereLetIn(
  userId: string,
  email: string,
  claims: EntraClaims,
  name: string | null
) {
  for (const [how, join] of [
    ['verified domain', () => joinByVerifiedDomain(email, name)],
    ['trusted tenant', () => joinByTrustedTenant(userId, claims.tid, email)]
  ] as const) {
    try {
      const joined = await join();
      if (joined)
        console.info(
          `[auth] ${email} joined organisation ${joined} through its ${how}`
        );
    } catch (cause) {
      console.error(`[auth] could not join ${email} by ${how}:`, cause);
    }
  }
}

export async function resolveEntraSignIn(input: {
  claims: EntraClaims;
  name: string | null;
  /** Whether somebody who belongs nowhere may sign in to ask for an organisation. */
  requestsOpen: boolean;
}): Promise<EntraSignIn> {
  const { claims } = input;
  const subject = entraSubject(claims);
  const email = claims.email?.trim().toLowerCase() || null;

  const addressProved = email
    ? domainOwnerVerified(claims) || (await tenantVouchesFor(email, claims.tid))
    : false;

  let user = await userForEntraSubject(subject);
  if (!user) {
    if (!email) return { outcome: 'refused', reason: 'no_email' };
    const existing = await userByEmail(email);
    if (existing) {
      if (existing.simulated)
        return { outcome: 'refused', reason: 'not_a_person' };
      const signedInBefore =
        existing.ssoSubject === `${ENTRA_PROVIDER}:${claims.sub}`;
      const reason: EntraRefusal | null = existing.entraSubject
        ? 'bound_elsewhere'
        : addressProved || signedInBefore
          ? null
          : 'address_not_proved';
      if (reason) {
        await recordRefusal(existing, claims, reason);
        return { outcome: 'refused', reason };
      }
      user = existing;
    } else {
      if (!addressProved)
        return { outcome: 'refused', reason: 'address_not_proved' };
      // Only somebody something lets in gets an account: a domain or tenant
      // they may join through, or the chance to ask for an organisation.
      const joined = await joinByVerifiedDomain(email, input.name);
      if (joined)
        console.info(
          `[auth] ${email} joined organisation ${joined} through its verified domain`
        );
      user = await userByEmail(email);
      if (!user && (input.requestsOpen || (await tenantTrusted(claims.tid)))) {
        await db
          .insert(users)
          .values({ email, name: input.name })
          .onConflictDoNothing({ target: users.email });
        user = await userByEmail(email);
      }
      if (!user) return { outcome: 'refused', reason: 'no_account' };
    }

    const [bound] = await db
      .update(users)
      .set({ entraSubject: subject })
      .where(and(eq(users.id, user.id), isNull(users.entraSubject)))
      .returning({ id: users.id });
    // Somebody else's sign-in bound the address first.
    if (!bound) return { outcome: 'refused', reason: 'bound_elsewhere' };
  }
  if (user.simulated) return { outcome: 'refused', reason: 'not_a_person' };

  await db
    .update(users)
    .set({
      ssoSubject: `${ENTRA_PROVIDER}:${claims.sub}`,
      lastSeenAt: new Date(),
      name: user.name ?? input.name
    })
    .where(eq(users.id, user.id));

  // Joining matches the address, so only while the token still carries the
  // person's own, proved.
  if (addressProved && email === user.email)
    await joinWhereLetIn(user.id, email, claims, input.name);

  return {
    outcome: 'signed_in',
    userId: user.id,
    member: await isMember(user.id),
    addressProved: addressProved && email === user.email
  };
}
