import type { DataProtectionLaw } from '@/lib/dpa2018/applies';
import { appliesEu, appliesUk } from '@/lib/gdpr/regimes';
import type { ResolvedRef } from '@/lib/legal-refs';

const isGdpr = (r: ResolvedRef) =>
  r.regime === 'UK GDPR' || r.regime === 'EU GDPR';

/**
 * The references shown beside a question, for an assessment whose entity is
 * under `law`.
 *
 * Shipped templates cite the UK and EU GDPR articles side by side. An entity
 * under only one of them is shown only that one, so a UK-only organisation is
 * not pointed at EU law that does not bind it. A question citing only the
 * other law keeps it, rather than being left with no article at all.
 */
export function citedFor(
  codes: readonly string[],
  refs: Readonly<Record<string, ResolvedRef>>,
  law?: DataProtectionLaw
): ResolvedRef[] {
  const all = codes.map((code) => refs[code]).filter(Boolean);
  if (!law) return all;
  const kept = all.filter(
    (r) =>
      !(r.regime === 'UK GDPR' && !appliesUk(law)) &&
      !(r.regime === 'EU GDPR' && !appliesEu(law))
  );
  return kept.some(isGdpr) || !all.some(isGdpr) ? kept : all;
}
