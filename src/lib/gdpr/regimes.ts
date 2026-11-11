/**
 * Which of the two GDPRs govern a record.
 *
 * Pure. The entity says which laws it is subject to (`entity.data_protection_law`);
 * each record says which of those govern it, and every rule is evaluated once
 * per law that applies. A dual entity's UK payroll may be under UK law only, and
 * its EU customer records under both. `DataProtectionLaw` is reused for a
 * record's laws, so a record can only ever name a subset of its entity's.
 */

import type { DataProtectionLaw } from '@/lib/dpa2018/applies';

export type Law = 'uk' | 'eu';

/** The names of the two laws, as gaps and headings use them. */
export const LAW_NAMES: Record<Law, string> = {
  uk: 'UK GDPR',
  eu: 'EU GDPR'
};

/** The choice offered on a record of an entity under both laws. */
export const RECORD_LAWS: Record<DataProtectionLaw, string> = {
  uk_eu: 'Both the UK GDPR and the EU GDPR',
  uk: 'The UK GDPR only',
  eu: 'The EU GDPR only'
};

export function lawsOf(law: DataProtectionLaw): Law[] {
  return law === 'uk_eu' ? ['uk', 'eu'] : [law];
}

export function appliesUk(law: DataProtectionLaw | null | undefined): boolean {
  return law !== 'eu';
}

export function appliesEu(law: DataProtectionLaw | null | undefined): boolean {
  return law === 'eu' || law === 'uk_eu';
}

/** "UK GDPR", "EU GDPR" or "UK GDPR and EU GDPR". */
export function lawsLabel(law: DataProtectionLaw): string {
  return lawsOf(law)
    .map((l) => LAW_NAMES[l])
    .join(' and ');
}

/** Whether a record's laws are among its entity's. */
export function withinEntity(
  entityLaw: DataProtectionLaw,
  recordLaw: DataProtectionLaw
): boolean {
  return entityLaw === 'uk_eu' || entityLaw === recordLaw;
}

/**
 * The laws that actually govern a record: its own, within its entity's. A
 * record is never judged under a law its entity is not subject to, whatever
 * it says.
 */
export function effectiveLaws(
  entityLaw: DataProtectionLaw,
  recordLaw: DataProtectionLaw | null | undefined
): DataProtectionLaw {
  if (entityLaw !== 'uk_eu') return entityLaw;
  return recordLaw ?? 'uk_eu';
}

/**
 * What a record's laws become when its entity is narrowed to `to`, or null
 * where the record is under the dropped law alone and a person must decide.
 */
export function narrowedTo(
  recordLaw: DataProtectionLaw,
  to: DataProtectionLaw
): DataProtectionLaw | null {
  if (to === 'uk_eu' || recordLaw === to) return recordLaw;
  return recordLaw === 'uk_eu' ? to : null;
}
