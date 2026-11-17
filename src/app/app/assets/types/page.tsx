import Link from 'next/link';
import { redirect } from 'next/navigation';

import { EditForm } from '@/components/EditForm';
import { HelpLink } from '@/components/help/HelpLink';
import { NotPermitted } from '@/components/NotPermitted';
import { BUILT_IN_ASSET_TYPES, DETAIL_FIELDS } from '@/lib/assets/types';
import { can } from '@/lib/rbac';
import { savedKey } from '@/lib/saved-key';
import { getActiveSession } from '@/lib/session';
import { ownAssetTypes } from '@/services/asset-types';

import { inputClass, Label } from '../../requests/fields';
import {
  createAssetTypeAction,
  deleteAssetTypeAction,
  setAssetTypeRetiredAction,
  updateAssetTypeAction
} from './actions';

const button =
  'rounded border border-line bg-surface px-4 py-2 text-sm hover:border-brand';

function TypeFields({
  values
}: {
  values?: { label: string; definition: string; hasExpiry: boolean };
}) {
  return (
    <>
      <label className="block space-y-1">
        <Label text="Name" />
        <input
          name="label"
          required
          maxLength={60}
          defaultValue={values?.label ?? ''}
          placeholder="Mobile app"
          className={inputClass}
        />
      </label>
      <label className="block space-y-1">
        <Label
          text="Definition"
          hint="What belongs under this type, and what does not. It is shown wherever the type is offered."
        />
        <textarea
          name="definition"
          required
          rows={2}
          maxLength={1000}
          defaultValue={values?.definition ?? ''}
          className={inputClass}
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="hasExpiry"
          defaultChecked={values?.hasExpiry ?? false}
        />
        Its assets expire or renew, with reminders before the date
      </label>
    </>
  );
}

export default async function AssetTypesPage() {
  const active = await getActiveSession();
  if (!active) redirect('/sign-in');
  const grants = active.membership.grants;
  if (!can(grants, 'record.read')) {
    return (
      <NotPermitted
        what="The asset types"
        organisationName={active.membership.organisationName}
      />
    );
  }
  const mayManage = can(grants, 'asset_type.manage');
  const own = await ownAssetTypes(active.membership.organisationId);

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-6 py-12">
      <header className="space-y-2 border-b border-line pb-6">
        <Link
          href="/app/assets"
          className="text-xs text-ink-soft hover:text-brand"
        >
          ← Information asset register
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Asset types</h1>
        <p className="max-w-prose text-sm text-ink-soft">
          What kinds of asset the register holds. The built-in types are always
          offered; the organisation can add its own, each with a definition so
          everyone uses it the same way.
          {mayManage
            ? ''
            : ' Owners and privacy administrators add and change them.'}
        </p>
      </header>

      <HelpLink topic="information-assets" />

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Built in</h2>
        <ul className="divide-y divide-line rounded border border-line bg-surface">
          {BUILT_IN_ASSET_TYPES.map((t) => (
            <li
              key={t.key}
              className="space-y-0.5 px-4 py-2.5 text-sm"
            >
              <p className="font-medium">
                {t.label}
                {t.hasExpiry ? (
                  <span className="ml-2 font-mono text-[11px] font-normal text-ink-soft">
                    expires
                  </span>
                ) : null}
              </p>
              <p className="text-xs text-ink-soft">{t.definition}</p>
              {t.fields.length > 0 ? (
                <p className="text-xs text-ink-soft">
                  Also records:{' '}
                  {t.fields
                    .map((f) => DETAIL_FIELDS[f].label.toLowerCase())
                    .join(', ')}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">The organisation&apos;s own</h2>
        {own.length === 0 ? (
          <p className="text-sm text-ink-soft">None added.</p>
        ) : (
          <ul className="space-y-3">
            {own.map((t) => (
              <li
                key={t.key}
                className="space-y-3 rounded border border-line bg-surface p-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium">
                    {t.label}
                    {t.retiredAt ? (
                      <span className="ml-2 font-mono text-[11px] font-normal text-ink-soft">
                        retired
                      </span>
                    ) : null}
                  </p>
                  <p className="text-xs text-ink-soft">
                    {t.assets} asset{t.assets === 1 ? '' : 's'}
                    {t.hasExpiry ? ' · expires' : ''}
                  </p>
                </div>
                {mayManage ? (
                  <>
                    <EditForm
                      key={savedKey(t.label, t.definition, t.hasExpiry)}
                      action={updateAssetTypeAction.bind(null, t.key)}
                      className="space-y-3"
                    >
                      <TypeFields values={t} />
                      <button
                        type="submit"
                        className={button}
                      >
                        Save the type
                      </button>
                    </EditForm>
                    <div className="flex flex-wrap gap-3 border-t border-line pt-3">
                      <EditForm
                        action={setAssetTypeRetiredAction.bind(
                          null,
                          t.key,
                          !t.retiredAt
                        )}
                      >
                        <button
                          type="submit"
                          className={button}
                        >
                          {t.retiredAt
                            ? 'Offer it again'
                            : 'Retire: offer it for no new asset'}
                        </button>
                      </EditForm>
                      {t.assets === 0 ? (
                        <EditForm
                          action={deleteAssetTypeAction.bind(null, t.key)}
                        >
                          <button
                            type="submit"
                            className="rounded border border-red-800 px-4 py-2 text-sm text-red-900 hover:bg-red-50"
                          >
                            Delete it
                          </button>
                        </EditForm>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-ink-soft">{t.definition}</p>
                )}
              </li>
            ))}
          </ul>
        )}
        {mayManage ? (
          <details className="rounded border border-line bg-surface">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
              Add a type
            </summary>
            {/* Keyed on the count, so the form empties once a type is added. */}
            <EditForm
              key={own.length}
              action={createAssetTypeAction}
              className="space-y-3 border-t border-line p-4"
            >
              <TypeFields />
              <button
                type="submit"
                className="rounded bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90"
              >
                Add the type
              </button>
            </EditForm>
          </details>
        ) : null}
      </section>
    </main>
  );
}
