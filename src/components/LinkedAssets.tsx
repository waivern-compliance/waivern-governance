import Link from 'next/link';

import { ASSET_TYPE_LABEL } from '@/lib/assets/register';
import type { assetsFor } from '@/services/information-assets';

/** The information assets a record is linked to, as shown on that record. */
export function LinkedAssets({
  assets,
  empty
}: {
  assets: Awaited<ReturnType<typeof assetsFor>>;
  empty: string;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">Information assets</h2>
      {assets.length > 0 ? (
        <ul className="space-y-0.5 text-sm">
          {assets.map((a) => (
            <li key={a.id}>
              <Link
                href={`/app/assets/${a.id}`}
                className="hover:text-brand"
              >
                <span className="font-mono text-xs text-ink-soft">
                  {a.reference}
                </span>{' '}
                {a.name}{' '}
                <span className="text-xs text-ink-soft">
                  {ASSET_TYPE_LABEL[a.assetType] ?? a.assetType}
                  {a.retiredAt ? ' (retired)' : ''}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-ink-soft">
          {empty}{' '}
          <Link
            href="/app/assets"
            className="text-brand hover:underline"
          >
            Information asset register
          </Link>
        </p>
      )}
    </section>
  );
}
