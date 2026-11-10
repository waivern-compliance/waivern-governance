import { headers } from 'next/headers';

/**
 * This deployment's own address as the browser reached it, for building the
 * public form addresses an organisation publishes. Behind more than one proxy
 * `x-forwarded-proto` can hold a list; the first is the client's.
 */
export async function requestOrigin(): Promise<string> {
  const h = await headers();
  const proto = h.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'http';
  const host =
    h.get('x-forwarded-host')?.split(',')[0]?.trim() || h.get('host');
  return `${proto}://${host}`;
}
