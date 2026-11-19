import { and, asc, eq, isNotNull } from 'drizzle-orm';

import { db, withOrganisation } from '@/db/client';
import {
  memberships,
  organisationDomains,
  organisationEntraTenants,
  roleAssignments
} from '@/db/schema';
import { appendAuditEvent } from '@/lib/audit';
import { domainOf } from '@/lib/auth/domains';
import {
  discoveryUrlFor,
  PERSONAL_ACCOUNTS_TENANT,
  tenantFromDiscovery
} from '@/lib/auth/entra';

import type { Actor } from './templates';
import { refuseDuringTrial } from './trial-guard';

/**
 * Microsoft Entra tenants an organisation trusts, and joining through them.
 *
 * A tenant is never typed in. It is found from one of the organisation's
 * DNS-verified domains by asking Microsoft which directory has verified the
 * same domain: Microsoft requires its own DNS proof before it will answer, so
 * both sides rest on control of the domain. A tenant id somebody pastes in
 * proves nothing about whose directory it is.
 */

export class TenantRefused extends Error {}

/** Asks Microsoft which tenant has verified a domain; null if none has. */
export type TenantLookup = (domain: string) => Promise<string | null>;

export const microsoftTenantLookup: TenantLookup = async (domain) => {
  const response = await fetch(
    discoveryUrlFor(domain, process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER),
    { signal: AbortSignal.timeout(10_000) }
  );
  if (!response.ok) return null;
  return tenantFromDiscovery(await response.json());
};

export async function tenantsFor(organisationId: string) {
  return withOrganisation(organisationId, () =>
    db
      .select({
        id: organisationEntraTenants.id,
        tenantId: organisationEntraTenants.tenantId,
        domainId: organisationEntraTenants.domainId,
        createdAt: organisationEntraTenants.createdAt
      })
      .from(organisationEntraTenants)
      .where(eq(organisationEntraTenants.organisationId, organisationId))
      .orderBy(asc(organisationEntraTenants.createdAt))
  );
}

/**
 * Trust the Microsoft tenant that has verified one of this organisation's
 * verified domains. People from it may then sign in at addresses on the
 * organisation's verified domains, and join as contributors.
 */
export async function trustTenant(input: {
  organisationId: string;
  domainId: string;
  actor: Actor;
  lookup?: TenantLookup;
}) {
  await refuseDuringTrial(input.organisationId, 'member.manage');
  const [claim] = await withOrganisation(input.organisationId, () =>
    db
      .select()
      .from(organisationDomains)
      .where(
        and(
          eq(organisationDomains.id, input.domainId),
          eq(organisationDomains.organisationId, input.organisationId)
        )
      )
  );
  if (!claim) throw new TenantRefused('No such domain claim.');
  if (!claim.verifiedAt)
    throw new TenantRefused(
      'Verify the domain first: its tenant is found through it.'
    );

  // Outside the transaction: an outside call must not hold the connection.
  let tenantId: string | null;
  try {
    tenantId = await (input.lookup ?? microsoftTenantLookup)(claim.domain);
  } catch {
    throw new TenantRefused(
      'Microsoft could not be reached to look up the tenant. Try again shortly.'
    );
  }
  if (!tenantId || tenantId === PERSONAL_ACCOUNTS_TENANT) {
    throw new TenantRefused(
      `No Microsoft Entra tenant has verified ${claim.domain}. Add and verify it as a custom domain in Entra first.`
    );
  }

  try {
    return await withOrganisation(input.organisationId, () =>
      db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(organisationEntraTenants)
          .where(
            and(
              eq(organisationEntraTenants.organisationId, input.organisationId),
              eq(organisationEntraTenants.tenantId, tenantId)
            )
          );
        if (existing) return existing;
        const [row] = await tx
          .insert(organisationEntraTenants)
          .values({
            organisationId: input.organisationId,
            domainId: claim.id,
            tenantId,
            trustedBy: input.actor.actorUserId ?? null
          })
          .returning();
        await appendAuditEvent(tx, {
          ...input.actor,
          organisationId: input.organisationId,
          action: 'organisation_entra_tenant.trusted',
          subjectType: 'organisation',
          subjectId: input.organisationId,
          after: { tenantId, domain: claim.domain }
        });
        return row;
      })
    );
  } catch (error) {
    const text = `${(error as Error).message} ${(error as Error & { cause?: Error }).cause?.message ?? ''}`;
    if (/organisation_entra_tenant_tenant_key/.test(text)) {
      throw new TenantRefused(
        'Another organisation already trusts that tenant.'
      );
    }
    throw error;
  }
}

export async function removeTenant(input: {
  organisationId: string;
  trustId: string;
  actor: Actor;
}) {
  return withOrganisation(input.organisationId, () =>
    db.transaction(async (tx) => {
      const [row] = await tx
        .delete(organisationEntraTenants)
        .where(
          and(
            eq(organisationEntraTenants.id, input.trustId),
            eq(organisationEntraTenants.organisationId, input.organisationId)
          )
        )
        .returning();
      if (!row) return null;
      // Nobody already in is removed, and anybody already bound stays bound:
      // the trust only decides who may be matched or join from now on.
      await appendAuditEvent(tx, {
        ...input.actor,
        organisationId: input.organisationId,
        action: 'organisation_entra_tenant.removed',
        subjectType: 'organisation',
        subjectId: input.organisationId,
        before: { tenantId: row.tenantId }
      });
      return row;
    })
  );
}

/**
 * At sign-in: whether the address's domain is a verified domain through which
 * an organisation trusts the token's tenant. Only that domain: Microsoft named
 * this tenant for it, not for the organisation's other domains. Read
 * outside any organisation's scope, as joining by domain is.
 */
export async function tenantVouchesFor(
  email: string,
  tenantId: string
): Promise<boolean> {
  const domain = domainOf(email);
  if (!domain) return false;
  const [row] = await db
    .select({ id: organisationEntraTenants.id })
    .from(organisationEntraTenants)
    .innerJoin(
      organisationDomains,
      eq(organisationDomains.id, organisationEntraTenants.domainId)
    )
    .where(
      and(
        eq(organisationEntraTenants.tenantId, tenantId),
        eq(organisationDomains.domain, domain),
        isNotNull(organisationDomains.verifiedAt)
      )
    )
    .limit(1);
  return Boolean(row);
}

/**
 * At sign-in: join the organisation that trusts this person's tenant, as a
 * contributor, mirroring joining by verified domain.
 *
 * Only for a person whose address is proved and who is already bound to this
 * Microsoft account, which the caller checks. Never for somebody who has ever
 * been a member of that organisation. Returns the organisation joined, or null.
 */
export async function joinByTrustedTenant(
  userId: string,
  tenantId: string,
  email: string
): Promise<string | null> {
  const [trust] = await db
    .select({ organisationId: organisationEntraTenants.organisationId })
    .from(organisationEntraTenants)
    .where(eq(organisationEntraTenants.tenantId, tenantId));
  if (!trust) return null;

  const [before] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.organisationId, trust.organisationId),
        eq(memberships.userId, userId)
      )
    );
  if (before) return null;

  await withOrganisation(trust.organisationId, () =>
    db.transaction(async (tx) => {
      const [membership] = await tx
        .insert(memberships)
        .values({ organisationId: trust.organisationId, userId })
        .returning();
      await tx.insert(roleAssignments).values({
        membershipId: membership.id,
        role: 'contributor',
        scope: 'organisation'
      });
      await appendAuditEvent(tx, {
        actorKind: 'system',
        actorUserId: null,
        actorLabel: email,
        organisationId: trust.organisationId,
        action: 'membership.joined_by_tenant',
        subjectType: 'membership',
        subjectId: membership.id,
        after: { email, tenantId, role: 'contributor' }
      });
    })
  );
  return trust.organisationId;
}
