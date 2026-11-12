import { NextRequest } from 'next/server';

import { handlers } from '@/auth';
import { signInOrigin } from '@/lib/app-url';

/**
 * Next.js gives a route handler its own `localhost:PORT` as the request's
 * address, whatever the browser asked for, and Auth.js builds the provider's
 * callback from it. Put back the address the browser used, when it is one this
 * deployment lists (see `src/lib/app-url.ts`).
 */
function atAddressUsed(req: NextRequest): NextRequest {
  const origin = signInOrigin(req.headers);
  if (!origin) return req;
  const { href, origin: given } = req.nextUrl;
  return new NextRequest(href.replace(given, origin), req);
}

export const GET = (req: NextRequest) => handlers.GET(atAddressUsed(req));
export const POST = (req: NextRequest) => handlers.POST(atAddressUsed(req));
