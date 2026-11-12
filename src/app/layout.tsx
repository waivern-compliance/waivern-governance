import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { connection } from 'next/server';

import { SiteFooter } from '@/components/site/SiteFooter';
import { BANNER_HEADER, PUBLIC_FORM_HEADER } from '@/lib/cookiebot';
import { waivernHosted } from '@/lib/hosting';
import { PRODUCT_DESCRIPTION, PRODUCT_NAME } from '@/lib/product';

import './globals.css';

export const metadata: Metadata = {
  // Each page names itself and the product names itself once, so a row of
  // browser tabs is readable rather than nine identical ones.
  title: { default: PRODUCT_NAME, template: `%s · ${PRODUCT_NAME}` },
  description: PRODUCT_DESCRIPTION
};

export default async function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  // Render every page per request, so Next.js can stamp each one's scripts
  // with the nonce its Content-Security-Policy allows (see `src/proxy.ts`). A
  // page prerendered at build time would carry no nonce, and its scripts would
  // be refused.
  await connection();
  // The consent banner where one is configured (`lib/cookiebot.ts`), and
  // Waivern's policies on Waivern's hosted service, neither of them on an
  // organisation's public request form. The proxy decides from the path.
  const sent = await headers();
  const banner = sent.get(BANNER_HEADER);
  const policies = waivernHosted() && sent.get(PUBLIC_FORM_HEADER) !== '1';
  return (
    <html lang="en-GB">
      {/* The page fills the screen above the footer, so the footer starts on
          the first screen of a short page rather than below it. */}
      <body className="grid min-h-dvh grid-rows-[1fr_auto] font-sans antialiased">
        <div>{children}</div>
        {policies || banner ? (
          <SiteFooter
            policies={policies}
            cookiebotId={banner}
          />
        ) : null}
      </body>
    </html>
  );
}
