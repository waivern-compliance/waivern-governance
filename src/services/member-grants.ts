import { and, eq } from 'drizzle-orm';

import { db, withOrganisation } from '@/db/client';
import { memberships, roleAssignments, users } from '@/db/schema';
import { can, type Grant } from '@/lib/rbac';

import { assertEntityIn } from './tenancy-guards';

/**
 * Who can act on a record in an entity, for naming people on it and sending
 * them its tasks. A task or a named role given to someone who cannot open the
 * record at all is one they can never act on.
 */

type Reader = Pick<typeof db, 'select'>;

export type MemberGrants = ReadonlyMap<
  string,
  { email: string; grants: Grant[] }
>;

/** Every active member's email and role grants, read once. */
export async function activeMemberGrants(
  reader: Reader,
  organisationId: string
): Promise<MemberGrants> {
  const rows = await reader
    .select({
      userId: memberships.userId,
      email: users.email,
      role: roleAssignments.role,
      scope: roleAssignments.scope,
      entityId: roleAssignments.entityId
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .innerJoin(
      roleAssignments,
      eq(roleAssignments.membershipId, memberships.id)
    )
    .where(
      and(
        eq(memberships.organisationId, organisationId),
        eq(memberships.isActive, true)
      )
    );
  const held = new Map<string, { email: string; grants: Grant[] }>();
  for (const r of rows) {
    const member = held.get(r.userId) ?? { email: r.email, grants: [] };
    member.grants.push(
      r.scope === 'entity' && r.entityId
        ? { role: r.role, scope: 'entity', entityId: r.entityId }
        : { role: r.role, scope: 'organisation' }
    );
    held.set(r.userId, member);
  }
  return held;
}

/** Whether this member can open records in the entity. */
export function mayOpenIn(
  members: MemberGrants,
  userId: string | null,
  entityId: string
): boolean {
  const member = userId ? members.get(userId) : undefined;
  return member !== undefined && can(member.grants, 'record.read', entityId);
}

/** Active members who can open records in this entity, by id, with their email. */
export function readersIn(members: MemberGrants, entityId: string) {
  return new Map(
    [...members]
      .filter(([, m]) => can(m.grants, 'record.read', entityId))
      .map(([userId, m]) => [userId, m.email])
  );
}

/** Whether one person is an active member who can open records in the entity. */
export async function canOpenRecordsIn(
  reader: Reader,
  organisationId: string,
  userId: string | null,
  entityId: string
): Promise<boolean> {
  if (!userId) return false;
  return mayOpenIn(
    await activeMemberGrants(reader, organisationId),
    userId,
    entityId
  );
}

/** Active members who can open records in this entity, to offer as an owner. */
export async function readersOf(organisationId: string, entityId: string) {
  return withOrganisation(organisationId, async () => {
    await assertEntityIn(organisationId, entityId);
    const members = await activeMemberGrants(db, organisationId);
    return [...readersIn(members, entityId)].map(([id, email]) => ({
      id,
      email
    }));
  });
}
