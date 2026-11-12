import Link from 'next/link';

import { Mark } from '@/components/Wordmark';
import { PRODUCT_SUFFIX, PRODUCT_VENDOR } from '@/lib/product';

/**
 * The masthead of the pages people see before they sign in: the wordmark,
 * and one call to action on the right.
 *
 * On the sign-in page the wordmark is the page's title; elsewhere it leads
 * back to sign-in, as a home link would.
 */
export function PublicHeader({
  home = false,
  action
}: {
  /** Whether this is the sign-in page itself. */
  home?: boolean;
  action: React.ReactNode;
}) {
  const wordmark = (
    <>
      <Mark className="h-9 w-9 text-navy" />
      {home ? (
        <h1 className="text-lg font-semibold tracking-tight">
          {PRODUCT_VENDOR}{' '}
          <span className="font-normal text-ink-soft">{PRODUCT_SUFFIX}</span>
        </h1>
      ) : (
        <span className="text-lg font-semibold tracking-tight">
          {PRODUCT_VENDOR}{' '}
          <span className="font-normal text-ink-soft">{PRODUCT_SUFFIX}</span>
        </span>
      )}
    </>
  );
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
        {home ? (
          <div className="flex items-center gap-3">{wordmark}</div>
        ) : (
          <Link
            href="/sign-in"
            className="flex items-center gap-3 rounded focus-visible:outline-2 focus-visible:outline-brand"
          >
            {wordmark}
          </Link>
        )}
        {action}
      </div>
    </header>
  );
}

/** The small filled button a public masthead carries on its right. */
export const headerAction =
  'whitespace-nowrap rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';
