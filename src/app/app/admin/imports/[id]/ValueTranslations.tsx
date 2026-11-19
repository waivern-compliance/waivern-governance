import type { ReactNode } from 'react';

import { inputClass } from '@/components/form-classes';

type Field = {
  key: string;
  label: string;
  /** The source's values, as written. */
  values: string[];
  /** What each may be said to be here. */
  options: Array<{ value: string; label: string }>;
  /** What was said before, by the value in lower case. */
  said: Record<string, string>;
  /** Set when the file holds more values not yet said than are listed. */
  more: boolean;
};

/**
 * A source's own values, for a person to say what each is here: a rating on
 * the organisation's scale, or a choice as one of Govern's values. Each is
 * sent as "value:<field>:<as written>", which the preview action reads.
 */
export function ValueTranslations({
  title,
  intro,
  emptyLabel,
  fields
}: {
  title: string;
  intro: ReactNode;
  /** The first option, meaning nothing has been said. */
  emptyLabel: string;
  fields: Field[];
}) {
  if (fields.length === 0) return null;
  return (
    <div className="space-y-3 rounded border border-line bg-surface p-4">
      <p className="max-w-prose text-sm">
        <span className="font-medium">{title}</span>{' '}
        <span className="text-ink-soft">{intro}</span>
      </p>
      {fields.map((field) => (
        <fieldset
          key={field.key}
          className="space-y-1"
        >
          <legend className="text-sm font-medium">{field.label}</legend>
          <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
            {field.values.map((v) => (
              <label
                key={v}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span className="truncate">{v}</span>
                <select
                  name={`value:${field.key}:${v.toLowerCase()}`}
                  defaultValue={field.said[v.toLowerCase()] ?? ''}
                  className={`${inputClass} max-w-48`}
                >
                  <option value="">{emptyLabel}</option>
                  {field.options.map((o) => (
                    <option
                      key={o.value}
                      value={o.value}
                    >
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {field.more ? (
            <p className="text-xs text-ink-soft">
              The file holds more values than are listed here. Say what these
              are and preview again, and the rest are listed next.
            </p>
          ) : null}
        </fieldset>
      ))}
    </div>
  );
}
