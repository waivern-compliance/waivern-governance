import { z } from 'zod';

/**
 * Microsoft Entra ID sign-in, and what its ID token proves.
 *
 * A single-tenant registration admits only the deployment's own directory,
 * whose administrators are trusted to say who has which address. A
 * multi-tenant registration admits any directory, and anybody can create one
 * and set any address on its users, so there the email claim proves nothing on
 * its own ("nOAuth"). Under a multi-tenant issuer a person is matched by their
 * tenant and object ids once bound, and an address is believed only when
 * Microsoft or a verified domain vouches for it.
 */

export const ENTRA_PROVIDER = 'microsoft-entra-id';

/** What the provider falls back to with no issuer configured. */
const DEFAULT_ISSUER = 'https://login.microsoftonline.com/common/v2.0';

/** Microsoft's own tenant for personal accounts (outlook.com, hotmail.com). */
export const PERSONAL_ACCOUNTS_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';

/** The issuer path segments that admit more than one directory. */
const MULTI_TENANT_SEGMENTS = new Set(['organizations', 'common', 'consumers']);

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type EntraMode = 'single' | 'multi';

function issuerUrl(issuer: string | undefined): URL | null {
  try {
    return new URL(issuer || DEFAULT_ISSUER);
  } catch {
    return null;
  }
}

/**
 * Whether the configured issuer admits one directory or many. An unset issuer
 * is the provider's `common`, so it is multi-tenant.
 */
export function entraMode(issuer: string | undefined): EntraMode {
  const segment = issuerUrl(issuer)?.pathname.split('/')[1]?.toLowerCase();
  return segment && MULTI_TENANT_SEGMENTS.has(segment) ? 'multi' : 'single';
}

/** Whether this deployment offers Microsoft sign-in to any directory. */
export function multiTenantEntraConfigured(
  env: Record<string, string | undefined> = process.env
): boolean {
  return (
    Boolean(env.AUTH_MICROSOFT_ENTRA_ID_ID) &&
    entraMode(env.AUTH_MICROSOFT_ENTRA_ID_ISSUER) === 'multi'
  );
}

/**
 * The claims Govern reads from a Microsoft ID token. `tid` and `oid` are GUIDs
 * Microsoft sets; `email` is whatever the directory says, and `xms_edov`, an
 * optional claim the registration must ask for, says whether Microsoft has
 * verified that the directory owns the address's domain.
 */
const EntraClaimsSchema = z.object({
  iss: z.string(),
  tid: z.string().regex(GUID),
  oid: z.string().regex(GUID),
  sub: z.string().min(1),
  email: z.string().optional(),
  xms_edov: z.unknown().optional()
});

export type EntraClaims = z.infer<typeof EntraClaimsSchema>;

export function entraClaims(profile: unknown): EntraClaims | null {
  const parsed = EntraClaimsSchema.safeParse(profile);
  return parsed.success
    ? {
        ...parsed.data,
        tid: parsed.data.tid.toLowerCase(),
        oid: parsed.data.oid.toLowerCase()
      }
    : null;
}

/** How a person is bound to one Microsoft account, whatever its address. */
export const entraSubject = (claims: Pick<EntraClaims, 'tid' | 'oid'>) =>
  `entra:${claims.tid}:${claims.oid}`;

/**
 * Whether Microsoft has verified that the token's directory owns the domain of
 * its email address. The claim is a boolean; a string form is accepted in case
 * a directory's claim mapping sends one.
 */
export function domainOwnerVerified(claims: EntraClaims): boolean {
  const v = claims.xms_edov;
  return v === true || v === 'true' || v === 1 || v === '1';
}

export type TokenProblem = 'issuer_mismatch' | 'personal_account';

/**
 * Why a multi-tenant ID token must be refused before anything else is read
 * from it, or null.
 *
 * The discovery document for `organizations` or `common` names its issuer as
 * `https://login.microsoftonline.com/{tenantid}/v2.0`, so a fixed issuer
 * cannot be compared. Each token's issuer must instead be that template filled
 * with the token's own `tid`. Auth.js already checks this by fetching the
 * tenant's own metadata before validating the token; checking again here keeps
 * the rule in Govern's hands if the library changes.
 */
export function tokenProblem(
  claims: EntraClaims,
  configuredIssuer: string | undefined
): TokenProblem | null {
  const base = issuerUrl(configuredIssuer);
  if (!base) return 'issuer_mismatch';
  if (claims.iss !== `${base.origin}/${claims.tid}/v2.0`)
    return 'issuer_mismatch';
  if (claims.tid === PERSONAL_ACCOUNTS_TENANT) return 'personal_account';
  return null;
}

/**
 * The tenant Microsoft's discovery document names, from its issuer, or null.
 * Asked for a domain, Microsoft answers only for the directory that has
 * verified it, so this ties a verified domain to its directory.
 */
export function tenantFromDiscovery(document: unknown): string | null {
  const issuer = z.object({ issuer: z.string() }).safeParse(document);
  if (!issuer.success) return null;
  const match = /^https:\/\/[^/]+\/([^/]+)\/v2\.0\/?$/.exec(issuer.data.issuer);
  return match && GUID.test(match[1]) ? match[1].toLowerCase() : null;
}

/** Where Microsoft says which directory has verified a domain, in the configured cloud. */
export function discoveryUrlFor(
  domain: string,
  configuredIssuer: string | undefined
): string {
  const origin =
    issuerUrl(configuredIssuer)?.origin ?? new URL(DEFAULT_ISSUER).origin;
  return `${origin}/${encodeURIComponent(domain)}/v2.0/.well-known/openid-configuration`;
}
