import type { Metadata } from "next";
import { connection } from "next/server";
import { PRODUCT_DESCRIPTION, PRODUCT_NAME } from "@/lib/product";
import "./globals.css";

export const metadata: Metadata = {
  // Each page names itself and the product names itself once, so a row of
  // browser tabs is readable rather than nine identical ones.
  title: { default: PRODUCT_NAME, template: `%s · ${PRODUCT_NAME}` },
  description: PRODUCT_DESCRIPTION,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Render every page per request, so Next.js can stamp each one's scripts
  // with the nonce its Content-Security-Policy allows (see `src/proxy.ts`). A
  // page prerendered at build time would carry no nonce, and its scripts would
  // be refused.
  await connection();
  return (
    <html lang="en-GB">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
