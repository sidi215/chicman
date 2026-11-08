/**
 * Supported UI locales and their text direction.
 * French (LTR) is the default; Arabic renders RTL.
 */
export const LOCALE_DIRECTION = { fr: "ltr", ar: "rtl" } as const;

export type Locale = keyof typeof LOCALE_DIRECTION;

export const LOCALES = Object.keys(LOCALE_DIRECTION) as Locale[];

export const DEFAULT_LOCALE: Locale = "fr";

/** The customer's choice, read by `proxy.ts`. Not sensitive, and written by the language switch. */
export const LOCALE_COOKIE = "chicman_locale";
const LOCALE_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

export function isLocale(value: string | undefined): value is Locale {
  return value !== undefined && Object.hasOwn(LOCALE_DIRECTION, value);
}

export function localeCookieOptions(secure: boolean) {
  return { path: "/", maxAge: LOCALE_COOKIE_MAX_AGE_SECONDS, sameSite: "lax", secure } as const;
}

/** Value for `document.cookie` that records the customer's choice. */
export function localeCookie(locale: Locale, secure: boolean): string {
  return `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secure ? "; Secure" : ""}`;
}

function splitLocale(pathname: string): { prefix: Locale | null; path: string } {
  const [, first, ...rest] = pathname.split("/");
  if (!isLocale(first)) return { prefix: null, path: pathname };
  return { prefix: first, path: `/${rest.join("/")}` };
}

/** The path without a locale prefix. */
export function withoutLocale(pathname: string): string {
  return splitLocale(pathname).path;
}

/**
 * Public pages that search engines index. Each language has its own URL here,
 * because crawlers keep no cookie. Other pages keep one URL (the email
 * callback's is on the Supabase allowlist) and follow the cookie.
 */
export function isStorefrontPath(path: string): boolean {
  return path === "/" || path === "/products" || path.startsWith("/products/");
}

/** The storefront URL of a path or href for a locale: French has no prefix. */
export function localizedPath(locale: Locale, href: string): string {
  if (locale === DEFAULT_LOCALE) return href;
  return href === "/" ? `/${locale}` : `/${locale}${href}`;
}

/** Where the language switch leads from the current page. */
export function switchedHref(pathname: string, search: string, target: Locale): string {
  const path = withoutLocale(pathname);
  return `${isStorefrontPath(path) ? localizedPath(target, path) : path}${search}`;
}

export type LocaleRoute =
  | { kind: "next" }
  | { kind: "rewrite"; pathname: string }
  | { kind: "redirect"; pathname: string; permanent: boolean; cookie?: Locale };

/**
 * Maps a public URL to the internal `/[locale]/…` route. French storefront
 * URLs have one address, without a prefix, and a saved choice of Arabic leads
 * to the Arabic URL. A request with no cookie, such as a crawler's, always
 * gets the language of the URL.
 */
export function routeLocale(pathname: string, cookie: string | undefined): LocaleRoute {
  const { prefix, path } = splitLocale(pathname);
  if (prefix === DEFAULT_LOCALE) return { kind: "redirect", pathname: path, permanent: true };
  if (prefix !== null) {
    if (isStorefrontPath(path)) return { kind: "next" };
    return { kind: "redirect", pathname: path, permanent: false, cookie: prefix };
  }
  const preferred = isLocale(cookie) ? cookie : DEFAULT_LOCALE;
  if (preferred !== DEFAULT_LOCALE && isStorefrontPath(path)) {
    return { kind: "redirect", pathname: localizedPath(preferred, path), permanent: false };
  }
  return { kind: "rewrite", pathname: path === "/" ? `/${preferred}` : `/${preferred}${path}` };
}
