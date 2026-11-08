import type { Metadata } from "next"
import { Suspense } from "react"

import { AddressEditor } from "@/features/addresses/components/address-screens"

export const metadata: Metadata = { title: "Nouvelle adresse · Chicman" }

async function NewAddressRoute({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { onboarding } = await searchParams
  return <AddressEditor onboarding={onboarding === "1"} />
}

export default function NewAddressPage({ searchParams }: PageProps<"/account/addresses/new">) {
  return (
    <Suspense>
      <NewAddressRoute searchParams={searchParams} />
    </Suspense>
  )
}
