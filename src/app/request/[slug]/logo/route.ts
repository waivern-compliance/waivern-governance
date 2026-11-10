import { intakeFormLogo } from '@/services/dsr-intake';

export const dynamic = 'force-dynamic';

/**
 * A public form's logo, from the form's own address, so the form's
 * Content-Security-Policy (`img-src 'self'`) needs no exception. The address
 * carries the logo's hash (`?v=`), so it can be cached hard: a new logo is a
 * new address.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const logo = await intakeFormLogo((await params).slug);
  if (!logo) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(logo.content), {
    headers: {
      'content-type': logo.contentType,
      'cache-control': 'public, max-age=31536000, immutable',
      'content-disposition': 'inline'
    }
  });
}
