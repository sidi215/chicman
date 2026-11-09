import type { Locale } from "./locale"

/** Date and time in the UI locale. */
export function formatDateTime(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-MR" : "fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso))
}
