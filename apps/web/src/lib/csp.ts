/**
 * Content Security Policy (spec 03, Abuse Protection; spec 06, shop logos).
 *
 * Host allowlist, not nonces: pages have a prerendered shell, and a per-request
 * nonce would force dynamic rendering of every route. Next.js
 * inlines its bootstrap scripts, so `script-src` needs 'unsafe-inline';
 * 'unsafe-eval' and WebSockets are allowed only in development (React
 * refresh / HMR).
 *
 * Only origins the app uses are listed: this site, Supabase Auth, the
 * Chicman API, Cloudflare Turnstile, the object-storage endpoint that
 * receives presigned logo PUTs (`connect-src`), and the public media origin
 * that serves verified logos (`img-src`). Fonts are self-hosted by next/font.
 *
 * Storage origins come from `NEXT_PUBLIC_STORAGE_UPLOAD_ORIGIN` and
 * `NEXT_PUBLIC_MEDIA_BASE_URL`. Only in development, when they are unset,
 * the local SeaweedFS origin (Docker Compose `object-storage`) is used.
 * A production build never falls back to it: it allows only the configured
 * origins (R2 in production).
 *
 * Maps (spec 05): the origin of the map style URL (`NEXT_PUBLIC_MAP_STYLE_URL`,
 * default OpenFreeMap) serves the style, tiles, sprites, and glyphs, all
 * fetched (`connect-src`). MapLibre runs its worker from a `blob:` wrapper
 * around `/maplibre/maplibre-gl-worker.mjs` (`worker-src 'self' blob:`).
 */

export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com"
/** Map style (spec 05): OpenFreeMap vector tiles unless configured otherwise. */
export const DEFAULT_MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty"
/** SeaweedFS S3 gateway of `infrastructure/docker` (development only). */
export const LOCAL_OBJECT_STORAGE_ORIGIN = "http://localhost:8333"

export interface CspEnv {
  NODE_ENV?: string | undefined
  NEXT_PUBLIC_SUPABASE_URL?: string | undefined
  NEXT_PUBLIC_API_URL?: string | undefined
  NEXT_PUBLIC_SITE_URL?: string | undefined
  NEXT_PUBLIC_STORAGE_UPLOAD_ORIGIN?: string | undefined
  NEXT_PUBLIC_MEDIA_BASE_URL?: string | undefined
  NEXT_PUBLIC_MAP_STYLE_URL?: string | undefined
}

/** Origin of a configured URL, or `null` when it is missing or invalid. */
export function originOf(value: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null
  } catch {
    return null
  }
}

export function isDevelopment(env: CspEnv): boolean {
  return env.NODE_ENV !== "production"
}

/** HSTS and `upgrade-insecure-requests` apply only once the site is served over HTTPS. */
export function isHttpsSite(env: CspEnv): boolean {
  return originOf(env.NEXT_PUBLIC_SITE_URL)?.startsWith("https://") ?? false
}

/** Origin of the map style (tiles, sprites, and glyphs come from the same provider). */
export function mapStyleUrl(env: CspEnv): string {
  return originOf(env.NEXT_PUBLIC_MAP_STYLE_URL) === null ? DEFAULT_MAP_STYLE_URL : (env.NEXT_PUBLIC_MAP_STYLE_URL ?? DEFAULT_MAP_STYLE_URL)
}

/** The configured storage origin, or the local SeaweedFS origin in development only. */
function storageOrigin(value: string | undefined, env: CspEnv): string | null {
  return originOf(value) ?? (isDevelopment(env) ? LOCAL_OBJECT_STORAGE_ORIGIN : null)
}

const present = (values: (string | null)[]): string[] => [...new Set(values.filter((value): value is string => value !== null))]

export function buildContentSecurityPolicy(env: CspEnv, options: { turnstile: boolean }): string {
  const dev = isDevelopment(env)

  const scriptSrc = ["'self'", "'unsafe-inline'"]
  if (options.turnstile) scriptSrc.push(TURNSTILE_ORIGIN)
  if (dev) scriptSrc.push("'unsafe-eval'")

  const connectSrc = present([
    "'self'",
    originOf(env.NEXT_PUBLIC_SUPABASE_URL),
    originOf(env.NEXT_PUBLIC_API_URL),
    storageOrigin(env.NEXT_PUBLIC_STORAGE_UPLOAD_ORIGIN, env),
    originOf(mapStyleUrl(env)),
  ])
  if (dev) connectSrc.push("ws:")

  const imgSrc = present(["'self'", "data:", "blob:", storageOrigin(env.NEXT_PUBLIC_MEDIA_BASE_URL, env)])

  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${imgSrc.join(" ")}`,
    "font-src 'self'",
    `connect-src ${connectSrc.join(" ")}`,
    `frame-src ${options.turnstile ? TURNSTILE_ORIGIN : "'none'"}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    ...(isHttpsSite(env) ? ["upgrade-insecure-requests"] : []),
  ].join("; ")
}
