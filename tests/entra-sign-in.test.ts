import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';

import { db, sql as pg } from '@/db/client';
import {
  auditEvents,
  entities,
  memberships,
  organisations,
  roleAssignments,
  users
} from '@/db/schema';
import { verificationRecordValue } from '@/lib/auth/domains';
import {
  domainOwnerVerified,
  entraClaims,
  entraMode,
  forLog,
  multiTenantEntraConfigured,
  PERSONAL_ACCOUNTS_TENANT,
  subjectToRecord,
  tenantFromDiscovery,
  tokenProblem,
  type EntraClaims
} from '@/lib/auth/entra';
import { claimDomain, removeDomain, verifyDomain } from '@/services/domains';
import {
  REFUSALS_RECORDED_PER_DAY,
  releaseEntraBinding,
  resolveEntraSignIn
} from '@/services/entra-sign-in';
import {
  TenantRefused,
  tenantsFor,
  trustTenant
} from '@/services/entra-tenants';

const SYSTEM = {
  actorKind: 'system' as const,
  actorUserId: null,
  actorLabel: 'entra test'
};

const MULTI = 'https://login.microsoftonline.com/organizations/v2.0';
const guid = () => crypto.randomUUID();
const freshDomain = () => `e${guid().slice(0, 8)}.example.gov.uk`;

async function organisation(label: string) {
  const [org] = await db
    .insert(organisations)
    .values({
      name: `Entra ${label}`,
      slug: `entra-${label}-${guid().slice(0, 8)}`
    })
    .returning();
  await db
    .insert(entities)
    .values({ organisationId: org.id, name: 'Main', isDefault: true });
  return org;
}

/** Somebody invited to the organisation, who has never signed in. */
async function invited(organisationId: string, email: string) {
  const [person] = await db.insert(users).values({ email }).returning();
  const [membership] = await db
    .insert(memberships)
    .values({ organisationId, userId: person.id })
    .returning();
  await db.insert(roleAssignments).values({
    membershipId: membership.id,
    role: 'contributor',
    scope: 'organisation'
  });
  return person;
}

/** An ID token's claims as Microsoft would issue them for a tenant. */
function token(
  tid: string,
  oid: string,
  email: string,
  extra: Partial<EntraClaims> = {}
): EntraClaims {
  return {
    iss: `https://login.microsoftonline.com/${tid}/v2.0`,
    tid,
    oid,
    sub: `sub-${oid}`,
    email,
    ...extra
  };
}

async function verifiedDomain(organisationId: string, domain: string) {
  const claim = await claimDomain({ organisationId, domain, actor: SYSTEM });
  await verifyDomain({
    organisationId,
    claimId: claim.id,
    actor: SYSTEM,
    lookup: async () => [[verificationRecordValue(claim.token)]]
  });
  return claim;
}

const microsoftSays = (tenantId: string | null) => async () => tenantId;

async function refusals(organisationId: string) {
  return db
    .select()
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.organisationId, organisationId),
        eq(auditEvents.action, 'user.sign_in_refused')
      )
    );
}

const signIn = (claims: EntraClaims, requestsOpen = false) =>
  resolveEntraSignIn({ claims, name: null, requestsOpen });

after(() => pg.end());

describe('the configured issuer', () => {
  it('treats one directory as single-tenant and the shared ones as multi-tenant', () => {
    assert.equal(
      entraMode(`https://login.microsoftonline.com/${guid()}/v2.0`),
      'single'
    );
    assert.equal(
      entraMode(
        'https://login.microsoftonline.com/contoso.onmicrosoft.com/v2.0'
      ),
      'single'
    );
    assert.equal(entraMode(MULTI), 'multi');
    assert.equal(
      entraMode('https://login.microsoftonline.com/common/v2.0'),
      'multi'
    );
    assert.equal(
      entraMode(undefined),
      'multi',
      "the provider's default is common"
    );
  });

  it('applies the multi-tenant rules only where a multi-tenant registration is configured', () => {
    assert.equal(
      multiTenantEntraConfigured({
        AUTH_MICROSOFT_ENTRA_ID_ID: 'app',
        AUTH_MICROSOFT_ENTRA_ID_ISSUER: `https://login.microsoftonline.com/${guid()}/v2.0`
      }),
      false
    );
    assert.equal(
      multiTenantEntraConfigured({
        AUTH_MICROSOFT_ENTRA_ID_ID: 'app',
        AUTH_MICROSOFT_ENTRA_ID_ISSUER: MULTI
      }),
      true
    );
    assert.equal(
      multiTenantEntraConfigured({ AUTH_MICROSOFT_ENTRA_ID_ISSUER: MULTI }),
      false,
      'no Microsoft sign-in at all'
    );
  });
});

describe('the issuer check', () => {
  const tid = guid();

  it("accepts a token whose issuer is its own tenant's", () => {
    assert.equal(tokenProblem(token(tid, guid(), 'a@b.c'), MULTI), null);
  });

  it("refuses a token whose issuer is another tenant's", () => {
    assert.equal(
      tokenProblem(
        {
          ...token(tid, guid(), 'a@b.c'),
          iss: `https://login.microsoftonline.com/${guid()}/v2.0`
        },
        MULTI
      ),
      'issuer_mismatch'
    );
    assert.equal(
      tokenProblem(
        {
          ...token(tid, guid(), 'a@b.c'),
          iss: 'https://login.microsoftonline.com/{tenantid}/v2.0'
        },
        MULTI
      ),
      'issuer_mismatch',
      'the unfilled template is not an issuer'
    );
    assert.equal(
      tokenProblem(
        {
          ...token(tid, guid(), 'a@b.c'),
          iss: `https://evil.example/${tid}/v2.0`
        },
        MULTI
      ),
      'issuer_mismatch',
      'another host'
    );
  });

  it('refuses personal Microsoft accounts', () => {
    assert.equal(
      tokenProblem(
        token(PERSONAL_ACCOUNTS_TENANT, guid(), 'a@outlook.com'),
        MULTI
      ),
      'personal_account'
    );
  });

  it('reads only tokens with a tenant and object id', () => {
    assert.equal(entraClaims({ iss: 'x', sub: 's', email: 'a@b.c' }), null);
    assert.equal(
      entraClaims({ iss: 'x', sub: 's', tid: 'not-a-guid', oid: guid() }),
      null
    );
    const upper = guid().toUpperCase();
    assert.equal(
      entraClaims({ iss: 'x', sub: 's', tid: upper, oid: guid() })?.tid,
      upper.toLowerCase()
    );
  });

  it("believes only Microsoft's word that the directory owns the domain", () => {
    const base = token(guid(), guid(), 'a@b.c');
    assert.equal(domainOwnerVerified(base), false);
    assert.equal(domainOwnerVerified({ ...base, xms_edov: false }), false);
    assert.equal(domainOwnerVerified({ ...base, xms_edov: true }), true);
  });

  it("reads the tenant from Microsoft's discovery document", () => {
    const tid = guid();
    assert.equal(
      tenantFromDiscovery({
        issuer: `https://login.microsoftonline.com/${tid}/v2.0`
      }),
      tid
    );
    assert.equal(
      tenantFromDiscovery({
        issuer: 'https://login.microsoftonline.com/{tenantid}/v2.0'
      }),
      null
    );
    assert.equal(tenantFromDiscovery({}), null);
  });
});

describe('what sign-in records', () => {
  it('never lets another provider replace a Microsoft subject', () => {
    assert.equal(
      subjectToRecord('microsoft-entra-id:abc', 'google:123'),
      'microsoft-entra-id:abc'
    );
    assert.equal(
      subjectToRecord('microsoft-entra-id:abc', 'microsoft-entra-id:def'),
      'microsoft-entra-id:def'
    );
    assert.equal(subjectToRecord('google:123', 'google:456'), 'google:456');
    assert.equal(subjectToRecord(null, 'google:123'), 'google:123');
  });

  it('quotes values from a token before they reach the log', () => {
    assert.equal(forLog('a@b.c\n[auth] forged'), '"a@b.c\\n[auth] forged"');
    assert.equal(forLog(undefined), 'null');
  });
});

describe('a first sign-in under a multi-tenant registration', () => {
  it('refuses an address spoofed from a tenant nobody vouches for, and tells the organisation', async () => {
    const org = await organisation('spoof');
    const email = `victim@${freshDomain()}`;
    const victim = await invited(org.id, email);

    const result = await signIn(token(guid(), guid(), email));
    assert.deepEqual(result, {
      outcome: 'refused',
      reason: 'address_not_proved'
    });
    const [person] = await db
      .select()
      .from(users)
      .where(eq(users.id, victim.id));
    assert.equal(person.entraSubject, null, 'nobody is bound');
    const [event] = await refusals(org.id);
    assert.equal(
      (event.after as Record<string, unknown>).reason,
      'address_not_proved'
    );
  });

  it("binds somebody invited when Microsoft vouches for their address's domain, and matches by the binding after", async () => {
    const org = await organisation('bind');
    const email = `person@${freshDomain()}`;
    const person = await invited(org.id, email);
    const tid = guid();
    const oid = guid();

    const first = await signIn(token(tid, oid, email, { xms_edov: true }));
    assert.equal(first.outcome, 'signed_in');
    assert.ok(first.outcome === 'signed_in' && first.member);
    const [bound] = await db
      .select()
      .from(users)
      .where(eq(users.id, person.id));
    assert.equal(bound.entraSubject, `entra:${tid}:${oid}`);

    // Their directory changes their address: they are still themselves.
    const later = await signIn(token(tid, oid, `renamed@${freshDomain()}`));
    assert.ok(later.outcome === 'signed_in' && later.userId === person.id);
  });

  it('refuses a different Microsoft account at a bound address, even one Microsoft vouches for', async () => {
    const org = await organisation('mismatch');
    const email = `bound@${freshDomain()}`;
    await invited(org.id, email);
    const tid = guid();
    await signIn(token(tid, guid(), email, { xms_edov: true }));

    for (const other of [
      token(tid, guid(), email, { xms_edov: true }),
      token(guid(), guid(), email, { xms_edov: true })
    ]) {
      assert.deepEqual(await signIn(other), {
        outcome: 'refused',
        reason: 'bound_elsewhere'
      });
    }
    assert.equal((await refusals(org.id)).length, 2);
  });

  it('binds a replacement account only once the operator releases the old one', async () => {
    const org = await organisation('release');
    const email = `rejoiner@${freshDomain()}`;
    const person = await invited(org.id, email);
    const tid = guid();
    await signIn(token(tid, guid(), email, { xms_edov: true }));
    const replacement = token(tid, guid(), email, { xms_edov: true });
    assert.equal((await signIn(replacement)).outcome, 'refused');

    assert.ok(await releaseEntraBinding(email, 'test operator'));
    const result = await signIn(replacement);
    assert.ok(result.outcome === 'signed_in' && result.userId === person.id);
    const released = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organisationId, org.id),
          eq(auditEvents.action, 'user.entra_binding_released')
        )
      );
    assert.equal(released.length, 1);
  });

  it('records repeated attempts once per account, and only so many a day', async () => {
    const org = await organisation('flood');
    const email = `target@${freshDomain()}`;
    await invited(org.id, email);
    const attacker = token(guid(), guid(), email);
    for (let i = 0; i < 3; i++) await signIn(attacker);
    assert.equal((await refusals(org.id)).length, 1, 'one account, once');

    for (let i = 0; i < REFUSALS_RECORDED_PER_DAY + 3; i++)
      assert.equal(
        (await signIn(token(guid(), guid(), email))).outcome,
        'refused'
      );
    assert.equal(
      (await refusals(org.id)).length,
      REFUSALS_RECORDED_PER_DAY,
      'refused every time, recorded up to the limit'
    );
  });

  it('moves the recorded subject when an account now signs in as somebody else', async () => {
    const org = await organisation('moved');
    const before = await invited(org.id, `before@${freshDomain()}`);
    const email = `after@${freshDomain()}`;
    const now = await invited(org.id, email);
    const claims = token(guid(), guid(), email, { xms_edov: true });
    await db
      .update(users)
      .set({ ssoSubject: `microsoft-entra-id:${claims.sub}` })
      .where(eq(users.id, before.id));

    const result = await signIn(claims);
    assert.ok(result.outcome === 'signed_in' && result.userId === now.id);
    const [old] = await db.select().from(users).where(eq(users.id, before.id));
    assert.equal(old.ssoSubject, null);
  });

  it('joins somebody new through a verified domain, already bound', async () => {
    const org = await organisation('domain-join');
    const domain = freshDomain();
    await verifiedDomain(org.id, domain);
    const claims = token(guid(), guid(), `fresh@${domain}`, { xms_edov: true });

    const result = await signIn(claims);
    assert.ok(result.outcome === 'signed_in' && result.member);
    const [person] = await db
      .select()
      .from(users)
      .where(eq(users.id, result.userId));
    assert.equal(person.entraSubject, `entra:${claims.tid}:${claims.oid}`);
  });

  it('recognises a Microsoft account that signed in before the registration became multi-tenant', async () => {
    const org = await organisation('legacy');
    const email = `old.hand@${freshDomain()}`;
    const person = await invited(org.id, email);
    const claims = token(guid(), guid(), email);
    await db
      .update(users)
      .set({ ssoSubject: `microsoft-entra-id:${claims.sub}` })
      .where(eq(users.id, person.id));

    const result = await signIn(claims);
    assert.ok(result.outcome === 'signed_in' && result.userId === person.id);
  });

  it('gives nobody an account when nothing lets them in', async () => {
    const result = await signIn(
      token(guid(), guid(), `stranger@${freshDomain()}`, { xms_edov: true })
    );
    assert.deepEqual(result, { outcome: 'refused', reason: 'no_account' });
  });

  it('lets a proved stranger in to ask for an organisation where requests are open', async () => {
    const email = `asker@${freshDomain()}`;
    const result = await signIn(
      token(guid(), guid(), email, { xms_edov: true }),
      true
    );
    assert.ok(result.outcome === 'signed_in');
    assert.equal(result.member, false);
    assert.equal(result.addressProved, true);
  });
});

describe('trusted tenants', () => {
  it('finds the tenant through a verified domain and records it', async () => {
    const org = await organisation('trust');
    const domain = freshDomain();
    const claim = await verifiedDomain(org.id, domain);
    const tid = guid();

    await trustTenant({
      organisationId: org.id,
      domainId: claim.id,
      actor: SYSTEM,
      lookup: microsoftSays(tid)
    });
    assert.deepEqual(
      (await tenantsFor(org.id)).map((t) => t.tenantId),
      [tid]
    );
    const [event] = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organisationId, org.id),
          eq(auditEvents.action, 'organisation_entra_tenant.trusted')
        )
      );
    assert.equal((event.after as Record<string, unknown>).tenantId, tid);
  });

  it('refuses a domain that is not verified, or that no tenant has verified', async () => {
    const org = await organisation('untrusted');
    const unverified = await claimDomain({
      organisationId: org.id,
      domain: freshDomain(),
      actor: SYSTEM
    });
    await assert.rejects(
      trustTenant({
        organisationId: org.id,
        domainId: unverified.id,
        actor: SYSTEM,
        lookup: microsoftSays(guid())
      }),
      /Verify the domain first/
    );
    const verified = await verifiedDomain(org.id, freshDomain());
    await assert.rejects(
      trustTenant({
        organisationId: org.id,
        domainId: verified.id,
        actor: SYSTEM,
        lookup: microsoftSays(null)
      }),
      TenantRefused
    );
  });

  it('lets only one organisation trust a tenant', async () => {
    const tid = guid();
    const first = await organisation('first');
    const second = await organisation('second');
    for (const org of [first, second]) {
      const claim = await verifiedDomain(org.id, freshDomain());
      const attempt = trustTenant({
        organisationId: org.id,
        domainId: claim.id,
        actor: SYSTEM,
        lookup: microsoftSays(tid)
      });
      if (org === first) await attempt;
      else await assert.rejects(attempt, /Another organisation already trusts/);
    }
  });

  it('matches an invitation at the trusted domain without Microsoft vouching', async () => {
    const org = await organisation('vouch');
    const domain = freshDomain();
    const claim = await verifiedDomain(org.id, domain);
    const tid = guid();
    await trustTenant({
      organisationId: org.id,
      domainId: claim.id,
      actor: SYSTEM,
      lookup: microsoftSays(tid)
    });
    const person = await invited(org.id, `colleague@${domain}`);

    const result = await signIn(token(tid, guid(), `colleague@${domain}`));
    assert.ok(result.outcome === 'signed_in' && result.userId === person.id);

    // Another tenant claiming the same domain is nobody's word.
    assert.deepEqual(await signIn(token(guid(), guid(), `other@${domain}`)), {
      outcome: 'refused',
      reason: 'address_not_proved'
    });
  });

  it('joins people from the trusted tenant as contributors', async () => {
    const org = await organisation('join');
    const claim = await verifiedDomain(org.id, freshDomain());
    const tid = guid();
    await trustTenant({
      organisationId: org.id,
      domainId: claim.id,
      actor: SYSTEM,
      lookup: microsoftSays(tid)
    });

    // An address at another of the tenant's domains, which Microsoft vouches for.
    const email = `newcomer@${freshDomain()}`;
    const result = await signIn(token(tid, guid(), email, { xms_edov: true }));
    assert.ok(result.outcome === 'signed_in' && result.member);
    const [event] = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organisationId, org.id),
          eq(auditEvents.action, 'membership.joined_by_tenant')
        )
      );
    assert.equal((event.after as Record<string, unknown>).email, email);

    // The tenant's word is not enough for an address at a domain nobody proved.
    assert.deepEqual(
      await signIn(token(tid, guid(), `unproved@${freshDomain()}`)),
      { outcome: 'refused', reason: 'address_not_proved' }
    );
  });

  it('stops trusting the tenant when its domain is removed, and records that', async () => {
    const org = await organisation('remove');
    const claim = await verifiedDomain(org.id, freshDomain());
    await trustTenant({
      organisationId: org.id,
      domainId: claim.id,
      actor: SYSTEM,
      lookup: microsoftSays(guid())
    });
    await removeDomain({
      organisationId: org.id,
      claimId: claim.id,
      actor: SYSTEM
    });
    assert.deepEqual(await tenantsFor(org.id), []);
    const removed = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organisationId, org.id),
          eq(auditEvents.action, 'organisation_entra_tenant.removed')
        )
      );
    assert.equal(removed.length, 1);
  });
});

describe('the sign-in callback', () => {
  /**
   * The deployment's issuer decides which rules apply, read on each sign-in.
   * A Microsoft sign-in as Auth.js hands it over.
   */
  async function callback(issuer: string, claims: EntraClaims) {
    process.env.AUTH_MICROSOFT_ENTRA_ID_ID = 'test-app';
    process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER = issuer;
    const { authConfig } = await import('@/auth');
    return authConfig.callbacks!.signIn!({
      user: { email: claims.email, name: null },
      account: {
        provider: 'microsoft-entra-id',
        providerAccountId: claims.sub,
        type: 'oidc'
      },
      profile: claims
    } as Parameters<
      NonNullable<NonNullable<typeof authConfig.callbacks>['signIn']>
    >[0]);
  }

  async function jwt(issuer: string, claims: Partial<EntraClaims>) {
    process.env.AUTH_MICROSOFT_ENTRA_ID_ID = 'test-app';
    process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER = issuer;
    const { authConfig } = await import('@/auth');
    const token = await authConfig.callbacks!.jwt!({
      token: {},
      user: { email: claims.email, name: null },
      account: {
        provider: 'microsoft-entra-id',
        providerAccountId: claims.sub ?? 'sub',
        type: 'oidc'
      },
      profile: claims
    } as Parameters<
      NonNullable<NonNullable<typeof authConfig.callbacks>['jwt']>
    >[0]);
    return (token as { userId?: string } | null)?.userId;
  }

  it('matches by address under a single-tenant registration, exactly as before', async () => {
    const org = await organisation('single');
    const email = `single@${freshDomain()}`;
    const person = await invited(org.id, email);
    const tid = guid();
    const issuer = `https://login.microsoftonline.com/${tid}/v2.0`;

    assert.equal(await callback(issuer, token(tid, guid(), email)), true);
    // Its one directory is trusted to say who has an address.
    assert.equal(await callback(issuer, token(tid, guid(), email)), true);
    const [row] = await db.select().from(users).where(eq(users.id, person.id));
    assert.equal(row.entraSubject, null, 'nobody is bound');
  });

  it('signs in somebody bound whose token carries no address, and puts them in the session', async () => {
    const org = await organisation('no-email');
    const email = `bound.later@${freshDomain()}`;
    const person = await invited(org.id, email);
    const claims = token(guid(), guid(), email, { xms_edov: true });
    assert.equal(await callback(MULTI, claims), true);

    const withoutEmail = { ...claims, email: undefined };
    assert.equal(await callback(MULTI, withoutEmail), true);
    assert.equal(await jwt(MULTI, withoutEmail), person.id);
  });

  it('puts the bound person in the session, not whoever has the address now', async () => {
    const org = await organisation('jwt');
    const first = `first@${freshDomain()}`;
    const person = await invited(org.id, first);
    const claims = token(guid(), guid(), first, { xms_edov: true });
    await callback(MULTI, claims);

    const second = `second@${freshDomain()}`;
    await invited(org.id, second);
    assert.equal(await jwt(MULTI, { ...claims, email: second }), person.id);
  });

  it('refuses a spoofed address under a multi-tenant registration', async () => {
    const org = await organisation('multi');
    const email = `multi@${freshDomain()}`;
    await invited(org.id, email);
    assert.equal(await callback(MULTI, token(guid(), guid(), email)), false);
  });

  it("refuses a token whose issuer is not its tenant's", async () => {
    const org = await organisation('issuer');
    const email = `issuer@${freshDomain()}`;
    await invited(org.id, email);
    const claims = token(guid(), guid(), email, { xms_edov: true });
    assert.equal(
      await callback(MULTI, {
        ...claims,
        iss: `https://login.microsoftonline.com/${guid()}/v2.0`
      }),
      false
    );
    assert.equal(await callback(MULTI, claims), true);
  });
});
