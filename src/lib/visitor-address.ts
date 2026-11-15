import { headers } from 'next/headers';

/**
 * The visitor's own address. Behind the hosting provider's proxy it is the
 * first in `x-forwarded-for`; the proxy sets the header, so a client cannot
 * put an address in front of its own.
 */
export async function visitorAddress(): Promise<string | null> {
  const h = await headers();
  return (
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    h.get('x-real-ip') ||
    null
  );
}
