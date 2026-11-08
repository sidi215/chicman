import type { Locale } from "./locale"

const FORMAT: Record<Locale, { group: string; decimal: string; currency: string }> = {
  fr: { group: "\u00A0", decimal: ",", currency: "MRU" },
  ar: { group: ",", decimal: ".", currency: "أوقية" },
}

/**
 * Formats an API price ("1500.50") in MRU. It works on the decimal string, so
 * the amount never passes through floating point. French groups thousands with
 * a no-break space: the narrow one (U+202F) is barely visible in the brand font.
 */
export function formatMru(price: string, locale: Locale): string {
  const { group, decimal, currency } = FORMAT[locale]
  const [whole = "0", fraction = ""] = price.split(".")
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, group)
  return `${grouped}${decimal}${fraction.padEnd(2, "0")}\u00A0${currency}`
}
