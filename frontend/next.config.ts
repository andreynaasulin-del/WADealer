import type { NextConfig } from 'next'

// Sanitize backend URL — strip newlines/whitespace from env var
const rawBackend = (process.env.NEXT_PUBLIC_BACKEND_URL || '').trim()
const BACKEND = rawBackend.startsWith('http') ? rawBackend : 'http://localhost:3001'

console.log(`[next.config] BACKEND rewrite target: ${BACKEND}`)

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${BACKEND}/api/:path*`,
      },
    ]
  },
}

export default nextConfig
