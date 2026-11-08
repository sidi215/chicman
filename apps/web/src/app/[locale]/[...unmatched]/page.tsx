import { notFound } from "next/navigation"

// This page never renders, so there is no navigation to validate.
export const instant = false

/** An unknown URL, shown in the visitor's language by the not-found page. */
export default function UnmatchedPage() {
  notFound()
}
