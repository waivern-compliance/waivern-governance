import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Microsoft's proof that this domain publishes the Entra app it signs in with.
 *
 * Entra shows users an app as "unverified" until its publisher domain is
 * verified, and verifies it by fetching this file from the domain. The
 * application id is the app's client id, so it is read from the deployment's
 * own sign-in settings: each deployment names its own app, and one without
 * Microsoft sign-in has nothing to claim. A client id is not a secret; it is
 * sent in the clear on every sign-in.
 */
export function GET() {
  const applicationId = process.env.AUTH_MICROSOFT_ENTRA_ID_ID;
  if (!applicationId) return new NextResponse(null, { status: 404 });
  return NextResponse.json({
    associatedApplications: [{ applicationId }]
  });
}
