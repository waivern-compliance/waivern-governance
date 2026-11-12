import { headers } from 'next/headers';

import { originFromHeaders } from '@/lib/app-url';

/**
 * This deployment's own address as the browser reached it, for building the
 * public form addresses an organisation publishes. Behind more than one proxy
 * `x-forwarded-proto` can hold a list; the first is the client's.
 */
export async function requestOrigin(): Promise<string> {
  return originFromHeaders(await headers());
}
