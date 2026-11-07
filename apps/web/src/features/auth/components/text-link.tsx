import Link from "next/link"
import type { ReactNode } from "react"

const CLASS = "type-label-large text-foreground underline-offset-4 hover:underline"

/**
 * `fullLoad`: a plain link (new document). Used on `/auth/callback`, so the
 * next page does not inherit the callback's strict Content Security Policy.
 */
export function TextLink({ href, children, fullLoad = false }: { href: string; children: ReactNode; fullLoad?: boolean }) {
  if (fullLoad) {
    return (
      <a href={href} className={CLASS}>
        {children}
      </a>
    )
  }
  return (
    <Link href={href} className={CLASS}>
      {children}
    </Link>
  )
}
