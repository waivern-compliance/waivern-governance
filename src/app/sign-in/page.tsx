import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth, authConfig, signIn } from '@/auth';
import { CheckList } from '@/components/site/CheckList';
import { headerAction, PublicHeader } from '@/components/site/PublicHeader';
import { HOSTED, waivernHosted } from '@/lib/hosting';
import { requestsOpen } from '@/lib/platform';
import { PRODUCT_DESCRIPTION, SOURCE_CODE_URL } from '@/lib/product';
import { getActiveSession } from '@/lib/session';

import { Hero, Pitch } from './Pitch';
import { ProviderButton, providerLabel } from './ProviderButton';

// Whether this is Waivern's hosted service is read when the page is served,
// not when it is built, so one image can be deployed either way.
export const dynamic = 'force-dynamic';

const asideLink =
  'block rounded px-2 py-1.5 text-sm text-ink-soft hover:bg-surface hover:text-brand focus-visible:outline-2 focus-visible:outline-brand';

export default async function SignIn({
  searchParams
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await getActiveSession()) redirect('/app');
  // Signed in, but a member of no organisation yet: somewhere to ask for one.
  if ((await auth())?.user?.id) redirect('/welcome');
  const { error } = await searchParams;
  // Auth.js reports a thrown callback as "Configuration". Here that means the
  // membership lookup failed rather than refused — usually the database being
  // unreachable — and saying "your account lacks access" would be wrong.
  const isFault = error === 'Configuration';
  const hosted = waivernHosted();
  const open = requestsOpen();

  const providers = authConfig.providers.map((p) => {
    const cfg = typeof p === 'function' ? p() : p;
    return {
      id: cfg.id as string,
      name: cfg.name as string,
      type: cfg.type as string
    };
  });
  const sso = providers.filter((p) => p.type !== 'credentials');
  const dev = providers.find((p) => p.type === 'credentials');

  // What a newcomer gets, beside the buttons. Each is true of the hosted
  // service only, so a self-hosted copy shows none of them.
  const promises = hosted
    ? [
        'Free, with no card needed',
        open
          ? 'Ask for an organisation of your own once signed in'
          : 'Sign in with the work account you already use',
        `Hosted in ${HOSTED.region}, backed up ${HOSTED.backups}`,
        'Export everything you keep, any time'
      ]
    : [];

  return (
    <div>
      <PublicHeader
        home
        action={
          <a
            href="#sign-in"
            className={`${headerAction} lg:hidden`}
          >
            Sign in
          </a>
        }
      />

      <main className="mx-auto grid max-w-6xl items-start gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:grid-rows-[auto_1fr] lg:gap-14 lg:py-16">
        <div className="lg:col-start-1 lg:row-start-1">
          {hosted ? (
            <Hero
              providers={sso.map((p) => providerLabel(p.id, p.name))}
              open={open}
            />
          ) : (
            <p className="text-ink-soft">{PRODUCT_DESCRIPTION}</p>
          )}
        </div>

        <aside className="lg:sticky lg:top-8 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <div className="space-y-6">
            <section
              id="sign-in"
              aria-labelledby="sign-in-heading"
              className="scroll-mt-6 space-y-5 rounded-xl border border-line bg-surface p-6 shadow-lg ring-1 ring-brand/10 target:ring-2 target:ring-brand"
            >
              <div className="space-y-1.5">
                <h2
                  id="sign-in-heading"
                  className="text-xl font-semibold tracking-tight text-navy"
                >
                  {hosted ? 'Get started free' : 'Sign in'}
                </h2>
                <p className="text-sm text-ink-soft">
                  {open
                    ? 'Sign in with your work account. New here? Once signed in, ask for an organisation of your own and we will set it up for you.'
                    : 'Sign in with the account your organisation invited.'}
                </p>
              </div>

              {error ? (
                <p
                  role="alert"
                  className="space-y-1 rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900"
                >
                  {isFault ? (
                    <>
                      <strong className="block">
                        Sign-in is not working right now.
                      </strong>
                      This is a fault on our side, not a problem with your
                      account - whether you have access was never established.
                      An administrator should check the server log; the cause is
                      recorded there.
                    </>
                  ) : (
                    <>
                      <strong className="block">
                        That account cannot sign in.
                      </strong>
                      Access is granted per email address, and the one your
                      identity provider just presented is not registered here.
                      The usual cause is signing in with a different account
                      from the one that was granted - check which account you
                      used. If it is the right one, ask an administrator to add
                      it.
                    </>
                  )}
                </p>
              ) : null}

              {sso.length > 0 ? (
                <div className="flex flex-col gap-3">
                  {sso.map((p) => (
                    <form
                      key={p.id}
                      action={async () => {
                        'use server';
                        await signIn(p.id, { redirectTo: '/app' });
                      }}
                    >
                      <ProviderButton
                        id={p.id}
                        name={p.name}
                      />
                    </form>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-ink-soft">
                  No identity provider is configured yet. Set the Entra ID or
                  Google credentials in the environment to enable single
                  sign-on.
                </p>
              )}

              {promises.length > 0 ? (
                <CheckList
                  items={promises}
                  className="space-y-2 border-t border-line pt-4 text-sm"
                />
              ) : null}

              {dev ? (
                <form
                  action={async (formData: FormData) => {
                    'use server';
                    await signIn('credentials', {
                      email: String(formData.get('email') ?? ''),
                      redirectTo: '/app'
                    });
                  }}
                  className="space-y-2 rounded border border-dashed border-line p-4"
                >
                  <label
                    htmlFor="email"
                    className="block text-xs font-medium uppercase tracking-wider text-ink-soft"
                  >
                    Development sign-in
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    required
                    defaultValue="dpo@example.bbc.co.uk"
                    className="w-full rounded border border-line bg-surface px-3 py-2 font-mono text-sm focus-visible:outline-2 focus-visible:outline-brand"
                  />
                  <button
                    type="submit"
                    className="w-full rounded border border-line bg-surface px-4 py-2 text-sm font-medium hover:border-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                  >
                    Sign in
                  </button>
                  <p className="text-xs text-ink-soft">
                    Local only. Any seeded user, no password.
                  </p>
                </form>
              ) : null}
            </section>

            <nav
              aria-label="About the service"
              className="space-y-1"
            >
              <p className="px-2 text-xs font-medium uppercase tracking-wider text-ink-soft">
                About the service
              </p>
              <Link
                href="/security"
                className={asideLink}
              >
                Security and backups
              </Link>
              {hosted ? (
                <>
                  <Link
                    href="/services"
                    className={asideLink}
                  >
                    Services and support
                  </Link>
                  <Link
                    href="/legal/terms"
                    className={asideLink}
                  >
                    Terms of Service
                  </Link>
                  <Link
                    href="/legal/dpa"
                    className={asideLink}
                  >
                    Data Processing Agreement
                  </Link>
                </>
              ) : null}
              <a
                href={SOURCE_CODE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={asideLink}
              >
                Source code (AGPL-3.0)
              </a>
            </nav>
          </div>
        </aside>

        {hosted ? (
          <div className="lg:col-start-1 lg:row-start-2">
            <Pitch />
          </div>
        ) : null}
      </main>
    </div>
  );
}
