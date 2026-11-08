import type { Metadata } from "next"
import { locale as rootLocale } from "next/root-params"

import { DEFAULT_LOCALE, isLocale, type Locale } from "./locale"

/** The locale of the current route, for server code. */
export async function currentLocale(): Promise<Locale> {
  const locale = await rootLocale()
  return isLocale(locale) ? locale : DEFAULT_LOCALE
}

/** `generateMetadata` for a page whose title only depends on the language. */
export function localizedMetadata(titles: Record<Locale, string>, extra: Metadata = {}) {
  return async (): Promise<Metadata> => ({ ...extra, title: titles[await currentLocale()] })
}
