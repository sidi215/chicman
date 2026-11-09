/**
 * Where an address screen hands back to. Only this fixed value is accepted, so
 * a link can never send the customer to an arbitrary page.
 *
 * Kept out of the client components so server pages can read it from the URL.
 */
export type AddressReturn = "checkout"

export function addressReturnFrom(value: string | string[] | undefined): AddressReturn | null {
  return value === "checkout" ? "checkout" : null
}
