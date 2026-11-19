import { and, eq, inArray } from 'drizzle-orm';
import NextAuth, { type NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import MicrosoftEntraID from 'next-auth/providers/microsoft-entra-id';

import { db } from '@/db/client';
import { memberships, trials, users } from '@/db/schema';
import { listsAddresses } from '@/lib/app-url';
import {
  mayJoinByDomain,
  mayRequestOrganisation,
  unverifiedEmail
} from '@/lib/auth/domains';
import {
  ENTRA_PROVIDER,
  entraClaims,
  entraMode,
  entraSubject,
  tokenProblem
} from '@/lib/auth/entra';
import type { Persona } from '@/lib/persona';
import { requestsOpen } from '@/lib/platform';
import type { Grant } from '@/lib/rbac';
import { trialsOpen } from '@/lib/trial';
import { joinByVerifiedDomain } from '@/services/domains';
import {
  describeRefusal,
  resolveEntraSignIn,
  userForEntraSubject
} from '@/services/entra-sign-in';
import { redeemTrialLink } from '@/services/trials';

/**
 * Only providers with credentials configured are offered, so a deployment can
 * run Entra ID alone, Google alone, or both. Multi-factor authentication is
 * delegated to the identity provider rather than reimplemented here — the
 * buyer's own conditional access policy should govern it.
 */
function providers() {
  const list = [];
  if (process.env.AUTH_MICROSOFT_ENTRA_ID_ID) {
    list.push(
      MicrosoftEntraID({
        clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
        clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
        issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER
      })
    );
  }
  if (process.env.AUTH_GOOGLE_ID) {
    list.push(
      Google({
        clientId: process.env.AUTH_GOOGLE_ID,
        clientSecret: process.env.AUTH_GOOGLE_SECRET
      })
    );
  }

  // Local development and demonstration only: sign in as any seeded user by
  // email, with no password. Two independent conditions must both hold, and the
  // production build refuses to start if the flag is set — a dev bypass that
  // can reach production is worse than no bypass at all.
  if (process.env.ALLOW_DEV_SIGN_IN === 'true') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'ALLOW_DEV_SIGN_IN must never be set in production. Remove it from the environment.'
      );
    }
    // The Credentials provider hardcodes its own id and name, so it is always
    // addressed as "credentials" and identified in the UI by its type.
    list.push(
      Credentials({
        credentials: { email: { label: 'Email', type: 'email' } },
        async authorize(credentials) {
          const email = String(credentials?.email ?? '').toLowerCase();
          if (!email) return null;
          const row = await db.query.users.findFirst({
            where: eq(users.email, email)
          });
          return row && !row.simulated
            ? { id: row.id, email: row.email, name: row.name }
            : null;
        }
      })
    );
  }

  // Self-service trials: the single-use link emailed to the address is the
  // proof that it is theirs, so using it signs them in. Its own id, so it is
  // never mistaken for the development sign-in above. See services/trials.ts.
  if (trialsOpen()) {
    list.push(
      Credentials({
        id: 'trial',
        name: 'Trial link',
        credentials: { token: { label: 'Token', type: 'text' } },
        async authorize(credentials) {
          const person = await redeemTrialLink(
            String(credentials?.token ?? '')
          );
          return person ? { id: person.id, email: person.email } : null;
        }
      })
    );
  }

  return list;
}

export type SessionMembership = {
  organisationId: string;
  organisationName: string;
  grants: Grant[];
  /** As stated on the membership. Null means nobody has chosen one yet. */
  persona: Persona | null;
  /**
   * Whether this person wants the step-by-step guide, and at which stage.
   * Null means unchosen, which is derived rather than defaulted to off.
   */
  guidance: 'off' | 'setup' | 'maintain' | null;
  /**
   * When the organisation is a trial that has not been converted: when it
   * ends. Its grants are marked `trial`, which withholds what a trial may
   * never do (`lib/trial.ts`).
   */
  trial: { endsAt: Date } | null;
};

/**
 * Resolve an authenticated identity to what it may do.
 *
 * Sign-in is not membership: a valid Entra ID token proves who someone is, not
 * that they belong to a client organisation. Someone with no active membership
 * is refused rather than admitted to an empty account — unless requests for new
 * organisations are open and their address is verified, in which case they may
 * sign in to ask for one, and see nothing else until it is approved.
 *
 * The result is used to decide whether sign-in may proceed. It is deliberately
 * NOT cached into the session token — see `loadMemberships`.
 */
export class IdentityLookupFailed extends Error {
  constructor(cause: unknown) {
    super('Could not check membership', { cause });
  }
}

async function loadIdentity(
  email: string,
  ssoSubject: string,
  name?: string | null,
  options: { createIfMissing?: boolean } = {}
) {
  let existing = await db.query.users.findFirst({
    where: eq(users.email, email.toLowerCase())
  });
  if (!existing && options.createIfMissing) {
    // Somebody new, who may ask for an organisation of their own.
    [existing] = await db
      .insert(users)
      .values({ email: email.toLowerCase(), name: name ?? null })
      .onConflictDoNothing({ target: users.email })
      .returning();
    existing ??= await db.query.users.findFirst({
      where: eq(users.email, email.toLowerCase())
    });
  }
  if (!existing) return null;
  // A trial's simulated colleague is a name on tasks, never somebody who
  // signs in, whatever provider claims the address.
  if (existing.simulated) return null;

  await db
    .update(users)
    .set({
      ssoSubject,
      lastSeenAt: new Date(),
      name: existing.name ?? name ?? null
    })
    .where(eq(users.id, existing.id));

  // Only whether they belong anywhere. What they may do, and how the platform
  // should present itself, is resolved per request by `loadMemberships` — this
  // was duplicating that mapping to answer a yes-or-no question.
  const [membership] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(eq(memberships.userId, existing.id), eq(memberships.isActive, true))
    )
    .limit(1);

  return { userId: existing.id, member: Boolean(membership) };
}

/**
 * Load an identity's current memberships and role grants.
 *
 * Called on every authenticated request rather than cached into the session
 * token. A JWT is valid until it expires and cannot be withdrawn, so grants
 * carried inside one stay live after they are revoked — on a twelve-hour token,
 * someone stripped of `risk.accept` would keep it for the rest of the day. One
 * indexed query per request is a cheap price for revocation taking effect when
 * it is made.
 */
export async function loadMemberships(
  userId: string
): Promise<SessionMembership[]> {
  const rows = await db.query.memberships.findMany({
    where: and(eq(memberships.userId, userId), eq(memberships.isActive, true)),
    with: { organisation: true, roles: true }
  });

  // Read with the memberships, on every request, for the same reason: an
  // administrator's conversion or extension takes effect at once.
  const trialRows = rows.length
    ? await db
        .select({
          organisationId: trials.organisationId,
          endsAt: trials.endsAt,
          status: trials.status
        })
        .from(trials)
        .where(
          inArray(
            trials.organisationId,
            rows.map((m) => m.organisationId)
          )
        )
    : [];
  const trialOf = new Map(
    trialRows
      .filter((t) => t.status !== 'converted')
      .map((t) => [t.organisationId, { endsAt: t.endsAt }])
  );

  return rows.map((m) => {
    const trial = trialOf.get(m.organisationId) ?? null;
    return {
      organisationId: m.organisationId,
      organisationName: m.organisation.name,
      persona: m.persona,
      guidance: m.guidance,
      trial,
      grants: m.roles.map((r) => ({
        ...(r.scope === 'entity' && r.entityId
          ? { role: r.role, scope: 'entity' as const, entityId: r.entityId }
          : { role: r.role, scope: 'organisation' as const }),
        ...(trial ? { trial: true } : {})
      }))
    };
  });
}

/**
 * Whether this sign-in came through a multi-tenant Microsoft registration,
 * where the address on the token proves nothing by itself. A single-tenant
 * registration keeps matching by address, as it always has: its one directory
 * is the deployment's own.
 */
function multiTenantEntra(provider: string) {
  return (
    provider === ENTRA_PROVIDER &&
    entraMode(process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER) === 'multi'
  );
}

/** See `services/entra-sign-in.ts` for who a multi-tenant sign-in may be. */
async function entraSignIn(profile: unknown, name: string | null) {
  const claims = entraClaims(profile);
  if (!claims) {
    console.warn('[auth] refused sign-in: Microsoft token lacks tid or oid');
    return false;
  }
  const problem = tokenProblem(
    claims,
    process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER
  );
  if (problem) {
    console.warn(
      `[auth] refused sign-in from tenant ${claims.tid}: ${
        problem === 'personal_account'
          ? 'personal Microsoft accounts are not accepted'
          : `issuer ${claims.iss} is not the tenant's own`
      }`
    );
    return false;
  }

  let result: Awaited<ReturnType<typeof resolveEntraSignIn>>;
  try {
    result = await resolveEntraSignIn({
      claims,
      name,
      requestsOpen: requestsOpen()
    });
  } catch (cause) {
    console.error(
      `[auth] could not check membership for ${claims.email} - this is not an ` +
        `authorisation decision, the lookup itself failed:`,
      cause
    );
    throw new IdentityLookupFailed(cause);
  }
  if (result.outcome === 'refused') {
    console.warn(
      `[auth] refused sign-in for ${claims.email ?? 'no address'} from tenant ${claims.tid}, ` +
        `object ${claims.oid}: ${describeRefusal(result.reason)}`
    );
    return false;
  }
  if (!result.member && !(result.addressProved && requestsOpen())) {
    console.warn(
      `[auth] refused sign-in: no active membership for ${claims.email} (via ${ENTRA_PROVIDER})`
    );
    return false;
  }
  return true;
}

/** How long a sign-in lasts before the identity provider is asked again. */
export const SESSION_HOURS = 12;

export const authConfig: NextAuthConfig = {
  providers: providers(),
  // With addresses listed, the host is trusted only after the proxy or the
  // auth route has checked it against the list (see src/lib/app-url.ts).
  ...(listsAddresses() ? { trustHost: true } : {}),
  session: { strategy: 'jwt', maxAge: SESSION_HOURS * 60 * 60 },
  pages: { signIn: '/sign-in', error: '/sign-in' },
  callbacks: {
    async signIn({ user, account, profile }) {
      if (!user.email || !account) return false;

      if (multiTenantEntra(account.provider))
        return entraSignIn(profile, user.name ?? null);

      // Membership is matched by email, so an address the provider has not
      // verified could sign somebody in as whoever was invited at it.
      if (
        unverifiedEmail(
          account.provider,
          profile as Record<string, unknown> | undefined
        )
      ) {
        console.warn(
          `[auth] refused sign-in: ${account.provider} has not verified ${user.email}`
        );
        return false;
      }

      // Somebody whose verified address is at a domain an organisation has
      // verified joins it, unless they have been a member before. Failing here
      // must not lock out somebody who is already a member somewhere, so it is
      // logged and sign-in carries on to the ordinary check.
      if (
        mayJoinByDomain(
          account.provider,
          profile as Record<string, unknown> | undefined
        )
      ) {
        try {
          const joined = await joinByVerifiedDomain(
            user.email,
            user.name ?? null
          );
          if (joined)
            console.info(
              `[auth] ${user.email} joined organisation ${joined} through its verified domain`
            );
        } catch (cause) {
          console.error(
            `[auth] could not join ${user.email} by domain:`,
            cause
          );
        }
      }

      /**
       * A failed lookup is not a refusal.
       *
       * Returning false here would tell the person their account lacks a
       * membership, when in fact nothing was ever checked — the database was
       * unreachable, or the query failed. That message sends an administrator
       * hunting through user records while the real fault is infrastructure.
       * Let it throw instead, so it surfaces as a configuration error and the
       * cause is in the log.
       */
      // Somebody who belongs nowhere may still sign in to ask for an
      // organisation — if their address is verified, and there is a Waivern
      // operator to ask. Otherwise they are refused, as they always were.
      const mayRequest =
        requestsOpen() &&
        mayRequestOrganisation(
          account.provider,
          profile as Record<string, unknown> | undefined
        );

      let identity: Awaited<ReturnType<typeof loadIdentity>>;
      try {
        identity = await loadIdentity(
          user.email,
          `${account.provider}:${account.providerAccountId}`,
          user.name,
          { createIfMissing: mayRequest }
        );
      } catch (cause) {
        console.error(
          `[auth] could not check membership for ${user.email} - this is not an ` +
            `authorisation decision, the lookup itself failed:`,
          cause
        );
        throw new IdentityLookupFailed(cause);
      }
      if (!identity?.member && !(identity && mayRequest)) {
        // Logged, not shown and not put in the URL. An administrator needs to
        // know which address was refused — it is often a different account from
        // the one they granted — but an email in a query string ends up in
        // browser history, referrers and access logs.
        console.warn(
          `[auth] refused sign-in: no active membership for ${user.email} (via ${account.provider})`
        );
        return false;
      }
      return true;
    },
    async jwt({ token, user, account, profile }) {
      // The token carries identity only. Authorisation is resolved per request
      // so that revoking a role takes effect immediately rather than whenever
      // the token happens to expire.
      if (user?.email && account && multiTenantEntra(account.provider)) {
        // Matched by the binding sign-in made, never by the address.
        const claims = entraClaims(profile);
        const bound =
          claims && (await userForEntraSubject(entraSubject(claims)));
        if (bound) token.userId = bound.id;
      } else if (user?.email && account) {
        const identity = await loadIdentity(
          user.email,
          `${account.provider}:${account.providerAccountId}`,
          user.name
        );
        // A member, or somebody who may ask for an organisation; anyone else
        // was refused at sign-in and never reaches here.
        if (identity) token.userId = identity.userId;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.userId as string;
      return session;
    }
  }
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

declare module 'next-auth' {
  interface Session {
    user: { id: string } & import('next-auth').DefaultSession['user'];
  }
}
