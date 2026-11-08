import type { NextConfig } from "next";

import { buildContentSecurityPolicy, isHttpsSite as siteIsHttps } from "./src/lib/csp";

// CSP builder and its development/production rules: src/lib/csp.ts.
const csp = (options: { turnstile: boolean }) => buildContentSecurityPolicy(process.env, options);
const isHttpsSite = siteIsHttps(process.env);

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Geolocation stays available to this site for delivery addresses (spec 05).
  { key: "Permissions-Policy", value: "camera=(), microphone=(), payment=(), usb=(), geolocation=(self)" },
  // HSTS only once the site is served over HTTPS (production domain pending).
  ...(isHttpsSite ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    // For a header key matched by several entries, the last entry wins.
    return [
      {
        source: "/:path*",
        headers: [...securityHeaders, { key: "Content-Security-Policy", value: csp({ turnstile: true }) }],
      },
      {
        // Confirmation and recovery tokens: no Referer, no caching, and no
        // third-party scripts (Turnstile included) on the callback.
        source: "/auth/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
      {
        source: "/auth/callback",
        headers: [{ key: "Content-Security-Policy", value: csp({ turnstile: false }) }],
      },
    ];
  },
};

export default nextConfig;
