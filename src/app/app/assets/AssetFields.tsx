import {
  ASSET_TYPE_LABEL,
  ASSET_TYPES,
  CLASSIFICATION_SCHEMES,
  HOSTING_LABEL,
  HOSTING_MODELS,
  levelsOf,
  type ClassificationScheme
} from '@/lib/assets/register';

import { inputClass, Label } from '../requests/fields';

type Values = {
  name: string;
  description: string | null;
  assetType: string;
  ownerId: string | null;
  hosting: string | null;
  hostedBy: string | null;
  region: string | null;
  countries: string[];
  classification: string | null;
  retention: string | null;
  nextReviewAt: Date | null;
};

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '');

/** The fields of an asset, shared by the form that adds one and the one that edits it. */
export function AssetFields({
  values,
  members,
  scheme
}: {
  values?: Values;
  members: Array<{ id: string; email: string }>;
  scheme: ClassificationScheme;
}) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <Label text="Name" />
          <input
            name="name"
            required
            defaultValue={values?.name ?? ''}
            placeholder="HR system"
            className={inputClass}
          />
        </label>
        <label className="block space-y-1">
          <Label text="Type" />
          <select
            name="assetType"
            defaultValue={values?.assetType ?? 'system'}
            className={inputClass}
          >
            {ASSET_TYPES.map((t) => (
              <option
                key={t}
                value={t}
              >
                {ASSET_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block space-y-1">
        <Label
          text="What it is for"
          hint="The system, not what is in it: the categories of personal data belong on the processing register."
        />
        <textarea
          name="description"
          rows={2}
          defaultValue={values?.description ?? ''}
          className={inputClass}
        />
      </label>
      <label className="block space-y-1">
        <Label
          text="Information asset owner"
          hint="The person accountable for it: who uses it, how it is protected, and what happens to it at the end."
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
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="sr-only">Where it is</legend>
        <label className="block space-y-1">
          <Label text="Hosting" />
          <select
            name="hosting"
            defaultValue={values?.hosting ?? ''}
            className={inputClass}
          >
            <option value="">Not yet recorded</option>
            {HOSTING_MODELS.map((h) => (
              <option
                key={h}
                value={h}
              >
                {HOSTING_LABEL[h]}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <Label
            text="Hosted by"
            hint="The provider, or the building."
          />
          <input
            name="hostedBy"
            defaultValue={values?.hostedBy ?? ''}
            placeholder="Microsoft Azure"
            className={inputClass}
          />
        </label>
        <label className="block space-y-1">
          <Label text="Region" />
          <input
            name="region"
            defaultValue={values?.region ?? ''}
            placeholder="UK South"
            className={inputClass}
          />
        </label>
        <label className="block space-y-1">
          <Label
            text="Countries"
            hint="Where it is held, separated by commas."
          />
          <input
            name="countries"
            defaultValue={values?.countries.join(', ') ?? ''}
            placeholder="United Kingdom"
            className={inputClass}
          />
        </label>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <Label
            text="Classification"
            hint={`On the ${CLASSIFICATION_SCHEMES[scheme].inSentence}.`}
          />
          <select
            name="classification"
            defaultValue={values?.classification ?? ''}
            className={inputClass}
          >
            <option value="">Not yet classified</option>
            {levelsOf(scheme).map(([key, label]) => (
              <option
                key={key}
                value={key}
              >
                {label}
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
      <label className="block space-y-1">
        <Label
          text="Retention"
          hint="How long what it holds is kept, and why: the schedule reference or the rule."
        />
        <input
          name="retention"
          defaultValue={values?.retention ?? ''}
          placeholder="Six years after employment ends (retention schedule HR-03)"
          className={inputClass}
        />
      </label>
    </>
  );
}
