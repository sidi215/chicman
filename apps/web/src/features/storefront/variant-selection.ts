import type { PublicProductVariant } from "@chicman/shared"

/**
 * Size and color selection on a product page. Availability itself comes from
 * the API; this only finds which variant the customer has chosen. A seller's
 * values ignore case within a product, so "M" and "m" are one option.
 */
export interface VariantChoice {
  size: string | null
  color: string | null
}

export const NO_CHOICE: VariantChoice = { size: null, color: null }

export interface VariantOption {
  value: string
  /** `false` when no in-stock variant has this value, given the other attribute's choice. */
  available: boolean
}

export type VariantSelection =
  /** Nothing to choose, or the choice is not finished. */
  | { state: "incomplete" }
  /** The chosen combination is not sold by this product. */
  | { state: "no-match" }
  | { state: "selected"; variant: PublicProductVariant }

const key = (value: string | null): string | null => (value === null ? null : value.toLocaleLowerCase("und"))

/** A variant with no value for an attribute matches only an empty choice when `exact`. */
function matches(variant: PublicProductVariant, choice: VariantChoice, exact: boolean): boolean {
  const fits = (own: string | null, chosen: string | null) => (chosen === null ? !exact || own === null : key(own) === key(chosen))
  return fits(variant.size, choice.size) && fits(variant.color, choice.color)
}

function options(
  variants: readonly PublicProductVariant[],
  read: (variant: PublicProductVariant) => string | null,
  fitsOther: (variant: PublicProductVariant) => boolean
): VariantOption[] {
  const byKey = new Map<string, VariantOption>()
  for (const variant of variants) {
    const value = read(variant)
    if (value === null) continue
    const id = key(value) as string
    const option = byKey.get(id) ?? { value, available: false }
    if (variant.available && fitsOther(variant)) option.available = true
    byKey.set(id, option)
  }
  return [...byKey.values()]
}

/** Sizes offered, marked unavailable according to the chosen color. */
export function sizeOptions(variants: readonly PublicProductVariant[], choice: VariantChoice): VariantOption[] {
  return options(variants, (variant) => variant.size, (variant) => choice.color === null || key(variant.color) === key(choice.color))
}

/** Colors offered, marked unavailable according to the chosen size. */
export function colorOptions(variants: readonly PublicProductVariant[], choice: VariantChoice): VariantOption[] {
  return options(variants, (variant) => variant.color, (variant) => choice.size === null || key(variant.size) === key(choice.size))
}

export function selectVariant(variants: readonly PublicProductVariant[], choice: VariantChoice): VariantSelection {
  if (choice.size === null && choice.color === null) return { state: "incomplete" }
  const variant = variants.find((candidate) => matches(candidate, choice, true))
  if (variant !== undefined) return { state: "selected", variant }
  return variants.some((candidate) => matches(candidate, choice, false)) ? { state: "incomplete" } : { state: "no-match" }
}

/** Selects a value, or clears it when it is already selected. */
export function toggleChoice(choice: VariantChoice, attribute: keyof VariantChoice, value: string): VariantChoice {
  return { ...choice, [attribute]: key(choice[attribute]) === key(value) ? null : value }
}

export function isChosen(chosen: string | null, value: string): boolean {
  return key(chosen) === key(value)
}
