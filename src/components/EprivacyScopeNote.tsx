import {
  effectiveEprivacy,
  EPRIVACY_SCOPE_PHRASES,
  type EprivacyScope
} from '@/lib/ie-eprivacy/scope';

/**
 * Which ePrivacy law a website, app or marketing activity is judged under,
 * and, where that includes the Irish Regulations, that Govern does not yet
 * check them: the bases and gaps shown are PECR's.
 */
export function EprivacyScopeNote({
  entity,
  scope,
  irishChecked = false
}: {
  entity: EprivacyScope | null;
  scope: EprivacyScope;
  /** Whether this register checks the Irish rules yet (cookies do; marketing comes later). */
  irishChecked?: boolean;
}) {
  const effective = effectiveEprivacy(entity, scope);
  if (!effective)
    return (
      <p className="max-w-prose rounded border border-amber-700 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        Its entity is no longer recorded as under the ePrivacy law this was
        recorded under. Check the entity on the Organisation page.
      </p>
    );
  return (
    <p className="max-w-prose text-sm text-ink-soft">
      Under {EPRIVACY_SCOPE_PHRASES[effective]}.
      {effective === 'uk'
        ? null
        : irishChecked
          ? " The Irish rules are checked beside each item: regulation 5 and the Data Protection Commission's cookie guidance."
          : " Govern does not check the Irish rules yet: the bases and gaps shown are PECR's, so judge it against S.I. 336/2011 itself."}
    </p>
  );
}
