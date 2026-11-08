"use client"

import { createContext, useContext, type ReactNode } from "react"

import { DEFAULT_LOCALE, type Locale } from "./locale"

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE)

/** The language of the page, set once by the root layout. */
export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext value={locale}>{children}</LocaleContext>
}

export function useLocale(): Locale {
  return useContext(LocaleContext)
}
