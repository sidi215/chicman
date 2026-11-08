"use client"

import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { FormMessage } from "@/features/auth/components/form-field"

import type { CatalogFailure } from "../catalog-query"
import { useStorefrontMessages } from "../messages"

/** A failed load, with a retry that asks the server to render the page again. */
export function CatalogFailureView({ failure }: { failure: CatalogFailure }) {
  const t = useStorefrontMessages()
  const router = useRouter()
  return (
    <div className="flex flex-col items-start gap-3">
      <FormMessage tone="error">{t.failures[failure]}</FormMessage>
      <Button variant="outline" onClick={() => router.refresh()}>
        {t.retry}
      </Button>
    </div>
  )
}
