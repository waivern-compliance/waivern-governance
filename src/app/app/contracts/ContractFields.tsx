import { inputClass, Label } from '../requests/fields';

type Values = {
  title: string;
  ownerId: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  noticeDays: number | null;
  autoRenews: boolean;
  value: string | null;
  currency: string | null;
};

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '');

/**
 * A contract's fields, for adding one and for editing it. The value and
 * currency appear only when `withTerms`: a form shown to somebody who may not
 * see the terms neither shows nor sends them.
 */
export function ContractFields({
  values,
  members,
  withTerms
}: {
  values?: Values;
  members: Array<{ id: string; email: string }>;
  withTerms: boolean;
}) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <Label text="Title" />
          <input
            name="title"
            required
            defaultValue={values?.title ?? ''}
            placeholder="Master services agreement"
            className={inputClass}
          />
        </label>
        <label className="block space-y-1">
          <Label
            text="Owner"
            hint="Who decides whether to renew. Reminders go to them."
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
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block space-y-1">
          <Label text="Starts" />
          <input
            type="date"
            name="startsAt"
            defaultValue={day(values?.startsAt ?? null)}
            className={inputClass}
          />
        </label>
        <label className="block space-y-1">
          <Label
            text="Ends"
            hint="Leave empty if it runs until ended."
          />
          <input
            type="date"
            name="endsAt"
            defaultValue={day(values?.endsAt ?? null)}
            className={inputClass}
          />
        </label>
        <label className="block space-y-1">
          <Label
            text="Notice period (days)"
            hint="Before the end date."
          />
          <input
            type="number"
            min={0}
            name="noticeDays"
            defaultValue={values?.noticeDays ?? ''}
            className={inputClass}
          />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="autoRenews"
          defaultChecked={values?.autoRenews ?? false}
          className="accent-brand"
        />
        Renews automatically unless notice is given
      </label>
      {withTerms ? (
        <fieldset className="grid gap-3 rounded border border-line p-3 sm:grid-cols-2">
          <legend className="px-1 text-xs font-medium uppercase tracking-wider text-ink-soft">
            Commercial terms
          </legend>
          <label className="block space-y-1">
            <Label
              text="Value"
              hint="The total, or per year: say which in the title."
            />
            <input
              name="value"
              inputMode="decimal"
              defaultValue={values?.value ?? ''}
              placeholder="120000"
              className={inputClass}
            />
          </label>
          <label className="block space-y-1">
            <Label text="Currency" />
            <input
              name="currency"
              defaultValue={values?.currency ?? 'GBP'}
              maxLength={3}
              className={inputClass}
            />
          </label>
        </fieldset>
      ) : null}
    </>
  );
}

/** Members who may see the terms, as checkboxes. */
export function ViewerFields({
  members,
  checked
}: {
  members: Array<{ id: string; email: string }>;
  checked: ReadonlySet<string>;
}) {
  return (
    <fieldset className="space-y-1.5">
      <legend>
        <Label
          text="Who else may see the commercial terms"
          hint="Besides whoever added it and those who may see every contract's terms."
        />
      </legend>
      {members.length > 0 ? (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {members.map((m) => (
            <label
              key={m.id}
              className="flex items-center gap-2.5 text-sm"
            >
              <input
                type="checkbox"
                name="viewerIds"
                value={m.id}
                defaultChecked={checked.has(m.id)}
                className="accent-brand"
              />
              {m.email}
            </label>
          ))}
        </div>
      ) : (
        <p className="text-xs text-ink-soft">No other members.</p>
      )}
    </fieldset>
  );
}
