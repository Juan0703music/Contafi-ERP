import type { NextConfig } from 'next';

const config: NextConfig = {
  // Los paquetes del monorepo se publican como TypeScript fuente.
  transpilePackages: ['@contafi/motor', '@contafi/shared', '@contafi/sync'],
  poweredByHeader: false,
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
      ],
    }];
  },
};

export default config;
