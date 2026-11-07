import Link from "next/link"

import { BrandLogo } from "@/components/brand/brand-logo"
import { ThemeSelector } from "@/components/theme/theme-selector"
import { buttonVariants } from "@/components/ui/button"

/**
 * Temporary home page until the storefront (product discovery) is built.
 * Uses the design tokens and the brand wordmark only.
 */
export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 bg-page px-4 py-10 text-center">
      {/* Temporary placement until the header / profile settings exist. */}
      <ThemeSelector className="fixed top-4 end-4 z-10" />
      <BrandLogo label="Chicman" size="lg" />
      <p className="type-body-large max-w-md text-muted-foreground">La marketplace de la mode en Mauritanie.</p>
      <div className="flex flex-wrap justify-center gap-3">
        <Link href="/register" className={buttonVariants()}>
          Créer un compte
        </Link>
        <Link href="/login" className={buttonVariants({ variant: "outline" })}>
          Se connecter
        </Link>
      </div>
    </main>
  )
}
