import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { auth, loadMemberships, type SessionMembership } from '@/auth';
import { refusable, type EditResult } from '@/lib/edit-result';
import { agreementStatus } from '@/services/agreements';

import { waivernHosted } from './hosting';
import { resolvePersona, type Persona } from './persona';
import { can, scopedEntityIds, withheldByTrial, type Capability } from './rbac';
import { TRIAL_REFUSAL, type TRIAL_WITHHELD } from './trial';

export class NotAuthenticated extends Error {
  constructor() {
    super('Not signed in');
  }
}

export class NotPermitted extends Error {
  constructor(capability: Capability, entityId?: string) {
    super(
      entityId
        ? `Missing ${capability} on entity ${entityId}`
        : `Missing ${capability}`
    );
  }
}

/**
 * Refused because the organisation is a trial, not because of the person's
 * role: said in words the person trying it can act on.
 */
export class TrialWithheld extends NotPermitted {
  constructor(capability: (typeof TRIAL_WITHHELD)[number]) {
    super(capability);
    this.message = TRIAL_REFUSAL[capability];
  }
}

/** Where a trial whose time is up is sent, from every page and action. */
export const TRIAL_ENDED_PATH = '/trial/ended';

export type ActiveSession = {
  userId: string;
  email: string;
  name: string | null;
  membership: SessionMembership;
  /**
   * How to present the platform to this person. Presentation only — every
   * authorisation decision goes through `can`, which never sees this.
   */
  persona: Persona;
  /** Every organisation this person may act in, for the switcher. */
  organisations: Array<{ organisationId: string; organisationName: string }>;
};

/**
 * The cookie holding which organisation somebody last chose to work in.
 *
 * A preference, never an authority: every request still finds the person's
 * active membership of that organisation, and a cookie naming one they do not
 * belong to — stale, or edited — is ignored.
 */
export const ORGANISATION_COOKIE = 'govern-organisation';

/**
 * Which membership a request acts through: the one preferred, if the person
 * still has it, otherwise the first by name — so the default is the same every
 * time, not whichever row the database happened to return first.
 */
export function chooseMembership<
  M extends { organisationId: string; organisationName: string }
>(memberships: readonly M[], preferred?: string | null): M | null {
  const ordered = [...memberships].sort((a, b) =>
    a.organisationName.localeCompare(b.organisationName)
  );
  return (
    (preferred
      ? ordered.find((m) => m.organisationId === preferred)
      : undefined) ??
    ordered[0] ??
    null
  );
}

async function preferredOrganisation(): Promise<string | null> {
  try {
    return (await cookies()).get(ORGANISATION_COOKIE)?.value ?? null;
  } catch {
    // Outside a request — a script or a test — there is no preference to read.
    return null;
  }
}

/** Where somebody goes to accept what is outstanding. */
export const AGREEMENTS_PATH = '/agreements';

/** Once per request, however many times a page and its actions ask. */
const outstandingAgreements = cache(
  async (userId: string, organisationId: string, grantsKey: string) =>
    !(
      await agreementStatus({
        userId,
        organisationId,
        grants: JSON.parse(grantsKey)
      })
    ).clear
);

/**
 * Resolve the caller and the organisation they are acting in.
 *
 * Most people belong to exactly one organisation; Waivern staff belong to
 * several. A caller that names an organisation gets exactly that one or
 * nothing. Otherwise it is the one the person last switched to, else the
 * first by name.
 *
 * On Waivern's hosted service this is also where the terms are enforced. Every
 * page, form action and download resolves its caller here, so anybody who has
 * not accepted the terms, or who can see an entity that has not accepted the
 * terms and the Data Processing Agreement, is sent to accept them before
 * anything is read or written. Only the acceptance page itself asks with
 * `agreements: 'skip'`.
 */
export async function getActiveSession(
  organisationId?: string,
  opts: { agreements?: 'enforce' | 'skip' } = {}
): Promise<ActiveSession | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  // Grants come from the database, not the token — see `loadMemberships`. This
  // also means a session that outlives its organisation or membership resolves
  // to null and lands back at sign-in, rather than rendering a half-broken page
  // against records it can no longer reach.
  const memberships = await loadMemberships(session.user.id);
  const membership = organisationId
    ? memberships.find((m) => m.organisationId === organisationId)
    : chooseMembership(memberships, await preferredOrganisation());
  if (!membership) return null;

  // A trial stops at its end, everywhere at once: every page, action and
  // download resolves its caller here.
  if (membership.trial && membership.trial.endsAt.getTime() <= Date.now())
    redirect(TRIAL_ENDED_PATH);

  if (
    opts.agreements !== 'skip' &&
    waivernHosted() &&
    (await outstandingAgreements(
      session.user.id,
      membership.organisationId,
      JSON.stringify(membership.grants)
    ))
  ) {
    redirect(AGREEMENTS_PATH);
  }

  return {
    userId: session.user.id,
    email: session.user.email ?? '',
    name: session.user.name ?? null,
    membership,
    persona: resolvePersona(membership.persona, membership.grants),
    organisations: chooseMembershipOrder(memberships)
  };
}

export async function requireSession(
  organisationId?: string
): Promise<ActiveSession> {
  const active = await getActiveSession(organisationId);
  if (!active) throw new NotAuthenticated();
  return active;
}

/**
 * Assert a capability before a write, naming the entity the write lands in.
 *
 * Call this with the entity of the record being changed, not the entity the
 * user is currently browsing — those differ whenever a record is reached from a
 * cross-entity list, and conflating them is how scoped access quietly leaks.
 */
export async function requireCapability(
  capability: Capability,
  opts: { organisationId?: string; entityId?: string } = {}
): Promise<ActiveSession> {
  const active = await requireSession(opts.organisationId);
  if (!can(active.membership.grants, capability, opts.entityId)) {
    if (withheldByTrial(active.membership.grants, capability))
      throw new TrialWithheld(capability as (typeof TRIAL_WITHHELD)[number]);
    throw new NotPermitted(capability, opts.entityId);
  }
  return active;
}

/**
 * `requireCapability` for an action that reports refusals beside its form
 * rather than on an error page: the refusal, through `refusable`, or null to
 * carry on. Used for the capabilities a trial is refused, so a trial is told
 * why where it tried.
 */
export async function refusedUnless(
  capability: Capability,
  opts: { organisationId?: string; entityId?: string } = {}
): Promise<Exclude<EditResult, null> | null> {
  const result = await refusable(() => requireCapability(capability, opts));
  return result && !result.ok ? result : null;
}

/** Entities this caller may exercise a capability over; `null` means all. */
export function visibleEntityIds(
  active: ActiveSession,
  capability: Capability = 'record.read'
): string[] | null {
  return scopedEntityIds(active.membership.grants, capability);
}

function chooseMembershipOrder(memberships: readonly SessionMembership[]) {
  return [...memberships]
    .sort((a, b) => a.organisationName.localeCompare(b.organisationName))
    .map(({ organisationId, organisationName }) => ({
      organisationId,
      organisationName
    }));
}
