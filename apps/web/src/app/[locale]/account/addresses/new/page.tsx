import { Suspense } from "react"

import { AddressEditor } from "@/features/addresses/components/address-screens"
import { localizedMetadata } from "@/lib/page-metadata"

export const generateMetadata = localizedMetadata({ fr: "Nouvelle adresse · Chicman", ar: "عنوان جديد · شيكمان" })

async function NewAddressRoute({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { onboarding } = await searchParams
  return <AddressEditor onboarding={onboarding === "1"} />
}

export default function NewAddressPage({ searchParams }: PageProps<"/[locale]/account/addresses/new">) {
  return (
    <Suspense>
      <NewAddressRoute searchParams={searchParams} />
    </Suspense>
  )
}
