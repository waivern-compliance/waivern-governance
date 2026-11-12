import type { NextRequest } from 'next/server';

import { handlers } from '@/auth';
import { atListedAddress } from '@/lib/app-url';

// API routes are outside the proxy, so the auth route checks its own address.
export const GET = (req: NextRequest) => handlers.GET(atListedAddress(req));
export const POST = (req: NextRequest) => handlers.POST(atListedAddress(req));
