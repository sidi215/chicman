import { DEFAULT_LOCALE, type Locale } from "./locale"

const FORMAT: Record<Locale, { group: string; decimal: string; currency: string }> = {
  fr: { group: " ", decimal: ",", currency: "MRU" },
  ar: { group: ",", decimal: ".", currency: "أوقية" },
}

/**
 * Formats an API price ("1500.50") in MRU. It works on the decimal string, so
 * the amount never passes through floating point.
 */
export function formatMru(price: string, locale: Locale = DEFAULT_LOCALE): string {
  const { group, decimal, currency } = FORMAT[locale]
  const [whole = "0", fraction = ""] = price.split(".")
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, group)
  return `${grouped}${decimal}${fraction.padEnd(2, "0")} ${currency}`
}
