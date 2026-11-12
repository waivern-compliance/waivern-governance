import {
  EPRIVACY_SCOPE_KEYS,
  EPRIVACY_SCOPES,
  type EprivacyScope
} from '@/lib/ie-eprivacy/scope';

/**
 * Which ePrivacy law a website, app or marketing activity is under. Asked
 * only where an entity is under both, because otherwise there is nothing to
 * choose; left at the entity's, the record takes all its entity's laws.
 */
export function EprivacyScopeField({
  label,
  defaultValue,
  inputClass
}: {
  label: React.ReactNode;
  /** For an edit form, the record's own scope; for a new record, the entity's. */
  defaultValue?: EprivacyScope;
  inputClass: string;
}) {
  return (
    <label className="block space-y-1">
      {label}
      <select
        name="eprivacyScope"
        defaultValue={defaultValue ?? ''}
        className={inputClass}
      >
        {defaultValue ? null : (
          <option value="">
            As its entity: every ePrivacy law it is under
          </option>
        )}
        {EPRIVACY_SCOPE_KEYS.map((k) => (
          <option
            key={k}
            value={k}
          >
            {EPRIVACY_SCOPES[k]}
          </option>
        ))}
      </select>
    </label>
  );
}
