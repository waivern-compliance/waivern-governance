/**
 * Which data protection law an entity is subject to.
 *
 * Part 2 of the Data Protection Act 2018 supplements the UK GDPR, so an entity
 * subject to the one is subject to the other, and to PECR and the Data (Use and
 * Access) Act 2025 amendments with them. An entity subject only to EU law — a
 * company established in an EU member State with no UK establishment and no
 * UK-targeted processing — is subject to none of them, and the questions,
 * decisions and flags that exist only because of the Act are not shown for it.
 *
 * Set per entity, because a group can have UK and EU companies. Pure. Which of
 * an entity's laws govern each record is `lib/gdpr/regimes.ts`.
 */

import { appliesUk } from '@/lib/gdpr/regimes';

export type DataProtectionLaw = 'uk' | 'eu' | 'uk_eu';

export const DATA_PROTECTION_LAWS: Record<DataProtectionLaw, string> = {
  uk: 'UK law - the UK GDPR, the Data Protection Act 2018 and PECR',
  eu: 'EU law only - the EU GDPR',
  uk_eu: 'Both UK and EU law'
};

export function isDataProtectionLaw(v: unknown): v is DataProtectionLaw {
  return typeof v === 'string' && v in DATA_PROTECTION_LAWS;
}

/** Whether the UK GDPR, the DPA 2018 and PECR apply to the entity or record. */
export const ukLawApplies = appliesUk;

/** The jurisdiction a request to the entity is handled under, where it is not stated. */
export function defaultRequestJurisdiction(
  law: DataProtectionLaw,
  organisationDefault: 'uk' | 'eu'
): 'uk' | 'eu' {
  return law === 'uk' ? 'uk' : law === 'eu' ? 'eu' : organisationDefault;
}

/**
 * The jurisdiction a complaint to the entity is handled under, where it is not
 * stated. Unlike a request, the organisation's default does not decide for an
 * entity under both laws: the duty to acknowledge within 30 days (DPA 2018
 * s.164A) applies wherever UK law does, and the EU GDPR sets no period, so the
 * UK clock is the one that can be missed.
 */
export function defaultComplaintJurisdiction(
  law: DataProtectionLaw
): 'uk' | 'eu' {
  return law === 'eu' ? 'eu' : 'uk';
}

/**
 * Why a request or complaint cannot be handled under this jurisdiction, or
 * null where it can: an entity under one law only cannot be asked to answer
 * under the other.
 */
export function jurisdictionRefusal(
  entity: { name: string; law: DataProtectionLaw },
  jurisdiction: 'uk' | 'eu',
  what: 'request' | 'complaint'
): string | null {
  if (entity.law === 'uk_eu' || entity.law === jurisdiction) return null;
  const law = (j: 'uk' | 'eu') => (j === 'uk' ? 'UK' : 'EU');
  return `${entity.name} is recorded as subject to ${law(entity.law)} law only, so a ${what} to it cannot be handled under ${law(jurisdiction)} law. Change the entity's law on the Organisation page if it is wrong.`;
}
