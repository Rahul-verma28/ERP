import { fileURLToPath } from "node:url"
import type { NextConfig } from "next"

// Repo root: lets the app import the API's dependency-free contracts (e.g. field rules)
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url))

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:5000"

// Signed-in areas and one-off links must never show up in search results
const NOINDEX = ["/app", "/app/:path*", "/console", "/console/:path*", "/partner", "/partner/:path*", "/start/:path*", "/d/:path*", "/pay/:path*", "/print/:path*", "/invite/:path*", "/verify-email", "/forgot-password"]

const nextConfig: NextConfig = {
  poweredByHeader: false,
  turbopack: { root: REPO_ROOT },
  outputFileTracingRoot: REPO_ROOT,
  // Same-origin API: the refresh-token cookie stays first-party and no CORS is needed
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: `${BACKEND_URL}/api/v1/:path*` }]
  },
  async headers() {
    return NOINDEX.map((source) => ({ source, headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] }))
  },
}

export default nextConfig
