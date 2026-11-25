import type { MetadataRoute } from "next"
import { SITE } from "@/lib/site"

// Private areas (workspaces, API, one-off links) are never crawled; next.config.ts also
// sends X-Robots-Tag: noindex on them in case a link to one leaks.
const PRIVATE = ["/app/", "/api/", "/d/", "/print/", "/invite/", "/verify-email", "/forgot-password"]

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: PRIVATE }],
    sitemap: `${SITE.url}/sitemap.xml`,
    host: SITE.url,
  }
}
