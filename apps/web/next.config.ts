import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

const TURNSTILE = "https://challenges.cloudflare.com";

/** Origin of a configured URL, or `null` when it is missing or invalid. */
function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

const supabase = originOf(process.env.NEXT_PUBLIC_SUPABASE_URL);
const api = originOf(process.env.NEXT_PUBLIC_API_URL);
const site = originOf(process.env.NEXT_PUBLIC_SITE_URL);
const isHttpsSite = site?.startsWith("https://") ?? false;

/**
 * Content Security Policy (spec 03, Abuse Protection). Host allowlist, not
 * nonces: every page is prerendered (static), and a per-request nonce would
 * force dynamic rendering of every route. Next.js inlines its bootstrap
 * scripts, so `script-src` needs 'unsafe-inline'; 'unsafe-eval' and
 * WebSockets are allowed only in development (React refresh / HMR).
 *
 * Only origins the app uses today are listed: this site, Supabase Auth, the
 * Chicman API, and Cloudflare Turnstile. Fonts are self-hosted by next/font.
 * Media storage (R2) and map tiles (MapLibre/OSM) are added with the features
 * that use them.
 */
function csp(options: { turnstile: boolean }): string {
  const scriptSrc = ["'self'", "'unsafe-inline'"];
  if (options.turnstile) scriptSrc.push(TURNSTILE);
  if (isDev) scriptSrc.push("'unsafe-eval'");

  const connectSrc = ["'self'", supabase, api].filter((value): value is string => value !== null);
  if (isDev) connectSrc.push("ws:");

  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${connectSrc.join(" ")}`,
    `frame-src ${options.turnstile ? TURNSTILE : "'none'"}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
    "worker-src 'self'",
    "manifest-src 'self'",
    ...(isHttpsSite ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

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
