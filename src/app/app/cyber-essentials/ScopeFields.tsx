import {
  SCOPE_KIND_LABEL,
  SCOPE_KINDS,
  type ScopeKind
} from '@/lib/cyber-essentials/scope-checks';

import { inputClass, Label } from '../requests/fields';

type Values = {
  name: string;
  kind: ScopeKind;
  boundary: string | null;
  segregation: string | null;
  exclusions: string | null;
  ownerId: string | null;
  nextReviewAt: Date | null;
  entityIds: readonly string[];
};

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '');

/** What a scope says about itself: the same fields to add one and to change it. */
export function ScopeFields({
  values,
  entities,
  home,
  members
}: {
  values?: Values;
  entities: ReadonlyArray<{ id: string; name: string }>;
  /** The home entity, always covered; absent while it is still being chosen. */
  home?: string;
  members: ReadonlyArray<{ id: string; email: string }>;
}) {
  return (
    <>
      <label className="block space-y-1">
        <Label
          text="Name"
          hint="What the certificate will cover, such as Head office and remote staff."
        />
        <input
          name="name"
          required
          maxLength={200}
          defaultValue={values?.name ?? ''}
          className={inputClass}
        />
      </label>
      <fieldset className="space-y-1">
        <legend>
          <Label
            text="Covers"
            hint="The whole organisation, or a well-defined, separately managed sub-set of it."
          />
        </legend>
        {SCOPE_KINDS.map((k) => (
          <label
            key={k}
            className="flex items-center gap-2 text-sm"
          >
            <input
              type="radio"
              name="kind"
              value={k}
              required
              defaultChecked={(values?.kind ?? 'whole_organisation') === k}
            />
            {SCOPE_KIND_LABEL[k]}
          </label>
        ))}
      </fieldset>
      <label className="block space-y-1">
        <Label
          text="How a sub-set is separated"
          hint="For a sub-set: the firewall or VLAN between it and the rest of the organisation."
        />
        <textarea
          name="segregation"
          rows={2}
          defaultValue={values?.segregation ?? ''}
          className={inputClass}
        />
      </label>
      <label className="block space-y-1">
        <Label
          text="Boundary"
          hint="The business unit, the network boundary and the locations, as the assessment asks for them."
        />
        <textarea
          name="boundary"
          rows={3}
          defaultValue={values?.boundary ?? ''}
          className={inputClass}
        />
      </label>
      <label className="block space-y-1">
        <Label
          text="Left out"
          hint="Anything outside the boundary, and why: the assessor asks for both."
        />
        <textarea
          name="exclusions"
          rows={2}
          defaultValue={values?.exclusions ?? ''}
          className={inputClass}
        />
      </label>
      <fieldset className="space-y-1">
        <legend>
          <Label
            text="Legal entities covered"
            hint="The assessment names each one. Only their assets can be placed in the scope."
          />
        </legend>
        {entities.map((e) => (
          <label
            key={e.id}
            className="flex items-center gap-2 text-sm"
          >
            <input
              type="checkbox"
              name="entityIds"
              value={e.id}
              disabled={e.id === home}
              defaultChecked={
                e.id === home || (values?.entityIds.includes(e.id) ?? false)
              }
            />
            {e.name}
            {e.id === home ? (
              <span className="text-xs text-ink-soft">(its home)</span>
            ) : null}
          </label>
        ))}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <Label
            text="Owner"
            hint="Who prepares it for assessment."
          />
          <select
            name="ownerId"
            defaultValue={values?.ownerId ?? ''}
            className={inputClass}
          >
            <option value="">Nobody yet</option>
            {members.map((m) => (
              <option
                key={m.id}
                value={m.id}
              >
                {m.email}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <Label text="Next review" />
          <input
            type="date"
            name="nextReviewAt"
            defaultValue={day(values?.nextReviewAt ?? null)}
            className={inputClass}
          />
        </label>
      </div>
    </>
  );
}
