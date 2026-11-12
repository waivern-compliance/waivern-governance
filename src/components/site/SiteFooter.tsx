import {
  VENDOR_COOKIE_POLICY_URL,
  VENDOR_PRIVACY_POLICY_URL
} from '@/lib/product';

import {
  CookieBanner,
  CookieDeclaration,
  CookieSettingsButton
} from './CookieControls';

const link =
  'underline-offset-4 hover:text-brand hover:underline focus-visible:outline-2 focus-visible:outline-brand';

/**
 * The foot of every page: Waivern's privacy and cookie policies on Waivern's
 * hosted service, and, where a consent banner is configured, a way back into
 * it and the cookies it asks about. Neither on a public request form.
 */
export function SiteFooter({
  policies,
  cookiebotId
}: {
  policies: boolean;
  cookiebotId: string | null;
}) {
  return (
    <footer className="border-t border-line bg-surface print:hidden">
      {cookiebotId ? <CookieBanner cookiebotId={cookiebotId} /> : null}
      <div className="mx-auto max-w-6xl space-y-3 px-4 py-6 text-sm text-ink-soft sm:px-6">
        <nav
          aria-label="Policies"
          className="flex flex-wrap items-center gap-x-6 gap-y-2"
        >
          {policies ? (
            <>
              <a
                href={VENDOR_PRIVACY_POLICY_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={link}
              >
                Privacy policy
              </a>
              <a
                href={VENDOR_COOKIE_POLICY_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={link}
              >
                Cookie policy
              </a>
            </>
          ) : null}
          {cookiebotId ? <CookieSettingsButton className={link} /> : null}
        </nav>
        {cookiebotId ? (
          <details>
            <summary className="cursor-pointer select-none hover:text-brand">
              Cookies on this site
            </summary>
            <div className="mt-3 max-h-96 overflow-auto rounded border border-line p-4">
              <CookieDeclaration cookiebotId={cookiebotId} />
            </div>
          </details>
        ) : null}
      </div>
    </footer>
  );
}
