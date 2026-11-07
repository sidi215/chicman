import type { ReactNode } from "react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { BrandLogo } from "@/components/brand/brand-logo"
import { ThemeSelector } from "@/components/theme/theme-selector"

/** Centered card layout shared by the auth screens. */
export function AuthShell({
  brand,
  title,
  description,
  children,
}: {
  brand: string
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 bg-page px-4 py-10">
      <ThemeSelector className="fixed top-4 end-4 z-10" />
      <BrandLogo label={brand} />
      <Card className="w-full max-w-md rounded-3xl p-6">
        <CardHeader>
          <CardTitle className="type-headline-small">{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">{children}</CardContent>
      </Card>
    </main>
  )
}
