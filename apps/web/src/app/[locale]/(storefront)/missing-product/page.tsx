import { notFound } from "next/navigation"

// This page never renders, so there is no navigation to validate.
export const instant = false

/**
 * `proxy.ts` rewrites a missing product here. A rewrite cannot set the status
 * of a prerendered page, but `notFound()` before streaming answers a real 404.
 */
export default function MissingProductPage() {
  notFound()
}
