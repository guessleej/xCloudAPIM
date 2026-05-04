/** @type {import('next').NextConfig} */
const config = {
  output: 'standalone',
  typescript: { ignoreBuildErrors: true },
  eslint:     { ignoreDuringBuilds: true },
  reactStrictMode: true,
  logging: { fetches: { fullUrl: true } },

  async rewrites() {
    return [
      {
        source:      '/graphql',
        destination: process.env.BFF_URL ?? 'http://localhost:4000/graphql',
      },
    ]
  },

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options',           value: 'DENY' },
          { key: 'X-Content-Type-Options',     value: 'nosniff' },
          { key: 'Referrer-Policy',            value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy',         value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ]
  },
}

export default config
