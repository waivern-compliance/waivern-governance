'use client';

import { useState } from 'react';

import {
  DETAIL_FIELDS,
  type AssetDetailValues,
  type DetailField
} from '@/lib/assets/types';

import { inputClass, Label } from '../requests/fields';

/** A type as the form needs it: serialisable, and only what it shows. */
export type TypeOption = {
  key: string;
  label: string;
  definition: string;
  hasExpiry: boolean;
  fields: readonly DetailField[];
};

type Values = {
  assetType: string;
  details: AssetDetailValues;
  expiresAt: Date | null;
  noticeDays: number | null;
  autoRenews: boolean;
};

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '');

/**
 * The asset's type, with its definition beside it, and the fields that type
 * carries. Changing the type changes the fields at once, so nobody records a
 * licence's seats on a domain.
 */
export function AssetTypeFields({
  types,
  values
}: {
  types: TypeOption[];
  values?: Values;
}) {
  const [key, setKey] = useState(values?.assetType ?? 'system');
  const type = types.find((t) => t.key === key) ?? types[0];
  const details = values?.assetType === type.key ? values.details : {};
  return (
    <>
      <label className="block space-y-1">
        <Label text="Type" />
        <select
          name="assetType"
          value={type.key}
          onChange={(e) => setKey(e.target.value)}
          className={inputClass}
        >
          {types.map((t) => (
            <option
              key={t.key}
              value={t.key}
            >
              {t.label}
            </option>
          ))}
        </select>
        <span className="block text-xs text-ink-soft">{type.definition}</span>
      </label>
      {type.fields.length > 0 ? (
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="sr-only">About this {type.label}</legend>
          {type.fields.map((f) => {
            const field = DETAIL_FIELDS[f];
            const value = details[f];
            return (
              <label
                key={`${type.key}-${f}`}
                className="block space-y-1"
              >
                <Label
                  text={field.label}
                  hint={field.hint}
                />
                {field.kind === 'choice' ? (
                  <select
                    name={`detail.${f}`}
                    defaultValue={value === undefined ? '' : String(value)}
                    className={inputClass}
                  >
                    <option value="">Not recorded</option>
                    {Object.entries(field.choices).map(([v, label]) => (
                      <option
                        key={v}
                        value={v}
                      >
                        {label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    name={`detail.${f}`}
                    type={
                      field.kind === 'count'
                        ? 'number'
                        : field.kind === 'date'
                          ? 'date'
                          : 'text'
                    }
                    min={field.kind === 'count' ? 1 : undefined}
                    defaultValue={
                      Array.isArray(value)
                        ? value.join(', ')
                        : value === undefined
                          ? ''
                          : String(value)
                    }
                    className={inputClass}
                  />
                )}
              </label>
            );
          })}
        </fieldset>
      ) : null}
      {type.hasExpiry ? (
        // Not keyed on the type: moving between two types that expire keeps
        // the dates, rather than clearing them and the reminder with them.
        <fieldset className="grid gap-3 sm:grid-cols-3">
          <legend className="sr-only">Expiry and renewal</legend>
          <label className="block space-y-1">
            <Label
              text="Expires or renews"
              hint="The date it lapses unless renewed."
            />
            <input
              type="date"
              name="expiresAt"
              defaultValue={day(values?.expiresAt ?? null)}
              className={inputClass}
            />
          </label>
          <label className="block space-y-1">
            <Label
              text="Notice (days)"
              hint="How long before then to act, or give notice."
            />
            <input
              type="number"
              min={0}
              name="noticeDays"
              defaultValue={values?.noticeDays ?? ''}
              className={inputClass}
            />
          </label>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input
              type="checkbox"
              name="autoRenews"
              defaultChecked={values?.autoRenews ?? false}
            />
            Renews automatically
          </label>
        </fieldset>
      ) : null}
    </>
  );
}
