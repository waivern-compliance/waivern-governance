/**
 * Which ePrivacy law governs an entity, a website or app, and a marketing
 * activity: UK PECR, the Irish ePrivacy Regulations (S.I. No. 336 of 2011),
 * or both.
 *
 * Pure. PECR follows UK law, as it always has. The Irish Regulations are a
 * fact a person declares about the entity (`entity.ie_eprivacy`), allowed only
 * where EU law applies to it: they reach whoever stores information on an
 * Irish user's device or markets to Irish subscribers, which Govern cannot
 * infer from the data protection law alone. A record says which of its
 * entity's ePrivacy laws govern it, the way a processing activity says which
 * of its entity's data protection laws do (`lib/gdpr/regimes.ts`).
 */

import type { DataProtectionLaw } from '@/lib/dpa2018/applies';
import { appliesEu, appliesUk } from '@/lib/gdpr/regimes';

export type EprivacyScope = 'uk' | 'ie' | 'uk_ie';

export const EPRIVACY_SCOPES: Record<EprivacyScope, string> = {
  uk: 'UK PECR',
  ie: 'The Irish ePrivacy Regulations (S.I. 336/2011)',
  uk_ie: 'Both UK PECR and the Irish ePrivacy Regulations'
};

/** The same, to read inside a sentence: "subject to UK PECR only". */
export const EPRIVACY_SCOPE_PHRASES: Record<EprivacyScope, string> = {
  uk: 'UK PECR',
  ie: 'the Irish ePrivacy Regulations (S.I. 336/2011)',
  uk_ie: 'both UK PECR and the Irish ePrivacy Regulations'
};

export const EPRIVACY_SCOPE_KEYS = Object.keys(
  EPRIVACY_SCOPES
) as EprivacyScope[];

export function isEprivacyScope(v: unknown): v is EprivacyScope {
  return typeof v === 'string' && v in EPRIVACY_SCOPES;
}

/** The parts of an entity these rules read. */
export type EprivacyEntity = {
  name: string;
  dataProtectionLaw: DataProtectionLaw;
  /** Null: not yet answered, which counts as no. */
  ieEprivacy: boolean | null;
};

const lawsOf = (scope: EprivacyScope | null) => ({
  uk: scope === 'uk' || scope === 'uk_ie',
  ie: scope === 'ie' || scope === 'uk_ie'
});

const scopeOf = (uk: boolean, ie: boolean): EprivacyScope | null =>
  uk && ie ? 'uk_ie' : uk ? 'uk' : ie ? 'ie' : null;

/** The ePrivacy laws an entity is subject to, or null where neither is. */
export function entityEprivacy(e: EprivacyEntity): EprivacyScope | null {
  return scopeOf(
    appliesUk(e.dataProtectionLaw),
    e.ieEprivacy === true && appliesEu(e.dataProtectionLaw)
  );
}

/** What a record is judged under: its own scope, within its entity's. */
export function effectiveEprivacy(
  entity: EprivacyScope | null,
  record: EprivacyScope
): EprivacyScope | null {
  const e = lawsOf(entity);
  const r = lawsOf(record);
  return scopeOf(e.uk && r.uk, e.ie && r.ie);
}

/** What a record of this entity is judged under, from the entity's columns; null where neither law reaches it. */
export function recordEprivacy(
  entity: Pick<EprivacyEntity, 'dataProtectionLaw' | 'ieEprivacy'>,
  scope: EprivacyScope
): EprivacyScope | null {
  return effectiveEprivacy(entityEprivacy({ name: '', ...entity }), scope);
}

export class EprivacyRefused extends Error {}

/**
 * The scope a record will hold: the one chosen, else its entity's. Refused
 * where neither law applies to the entity, and outside the entity's laws.
 */
export function cleanEprivacyScope(
  entity: EprivacyEntity,
  chosen: string | null | undefined
): EprivacyScope {
  const own = entityEprivacy(entity);
  if (!own)
    throw new EprivacyRefused(
      `Neither UK PECR nor the Irish ePrivacy Regulations apply to ${entity.name}. Record which applies on the Organisation page first.`
    );
  const scope = chosen || own;
  if (!isEprivacyScope(scope))
    throw new EprivacyRefused(
      'Choose UK PECR, the Irish ePrivacy Regulations, or both.'
    );
  if (effectiveEprivacy(own, scope) !== scope)
    throw new EprivacyRefused(
      `${entity.name} is subject to ${EPRIVACY_SCOPE_PHRASES[own]} only, so this cannot be under ${EPRIVACY_SCOPE_PHRASES[scope]}.`
    );
  return scope;
}

/**
 * Whether the Organisation page should ask about the Irish Regulations:
 * EU law applies, nobody has answered yet, and the entity is established in
 * Ireland or has the Data Protection Commission as its lead authority. A
 * suggestion to answer, never an answer.
 */
export function ieEprivacySuggested(e: {
  dataProtectionLaw: DataProtectionLaw;
  ieEprivacy: boolean | null;
  euEstablishments: readonly string[];
  euLeadAuthority: string | null;
}): boolean {
  return (
    e.ieEprivacy === null &&
    appliesEu(e.dataProtectionLaw) &&
    (e.euEstablishments.includes('IE') || e.euLeadAuthority === 'ie-dpc')
  );
}
