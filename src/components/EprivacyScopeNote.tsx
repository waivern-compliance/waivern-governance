import {
  effectiveEprivacy,
  EPRIVACY_SCOPES,
  type EprivacyScope
} from '@/lib/ie-eprivacy/scope';

/**
 * Which ePrivacy law a website, app or marketing activity is judged under,
 * and, where that includes the Irish Regulations, that Govern does not yet
 * check them: the bases and gaps shown are PECR's.
 */
export function EprivacyScopeNote({
  entity,
  scope
}: {
  entity: EprivacyScope | null;
  scope: EprivacyScope;
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
      Under {EPRIVACY_SCOPES[effective].charAt(0).toLowerCase()}
      {EPRIVACY_SCOPES[effective].slice(1)}.
      {effective === 'uk'
        ? null
        : " Govern does not check the Irish rules yet: the bases and gaps shown are PECR's, so judge it against S.I. 336/2011 itself."}
    </p>
  );
}
