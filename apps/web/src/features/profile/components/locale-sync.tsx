"use client"

import { useApplyProfileLocale } from "../use-locale-sync"

/** Renders nothing: it applies the signed-in user's language. */
export function LocaleSync() {
  useApplyProfileLocale()
  return null
}
