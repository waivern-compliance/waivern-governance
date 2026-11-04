import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    /**
     * Server actions cap request bodies at 1MB by default, which most signed
     * agreements exceed. Set a little above the per-file limit the upload
     * enforces, so the file is refused by a message that explains itself
     * rather than by a request that never arrives.
     */
    serverActions: { bodySizeLimit: '12mb' }
  },
  async headers() {
    // Sent on every response, pages and API routes alike. The page
    // Content-Security-Policy needs a fresh nonce per request, so it is set in
    // `src/proxy.ts` rather than here.
    const headers = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      // `frame-ancestors 'none'` in the CSP does the same for modern browsers;
      // this covers responses the proxy does not reach.
      { key: 'X-Frame-Options', value: 'DENY' },
      {
        key: 'Permissions-Policy',
        value: 'camera=(), microphone=(), geolocation=()'
      }
    ];
    // Production only: telling a browser to refuse plain HTTP for two years
    // is not something to do to localhost.
    if (process.env.NODE_ENV === 'production') {
      headers.push({
        key: 'Strict-Transport-Security',
        value: 'max-age=63072000; includeSubDomains'
      });
    }
    return [{ source: '/:path*', headers }];
  }
};

export default nextConfig;
