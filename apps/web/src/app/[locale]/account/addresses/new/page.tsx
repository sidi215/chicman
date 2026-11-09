import { Suspense } from "react"

import { addressReturnFrom } from "@/features/addresses/address-return"
import { AddressEditor } from "@/features/addresses/components/address-screens"
import { localizedMetadata } from "@/lib/page-metadata"

export const generateMetadata = localizedMetadata({ fr: "Nouvelle adresse · Chicman", ar: "عنوان جديد · شيكمان" })

async function NewAddressRoute({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { onboarding, returnTo } = await searchParams
  return <AddressEditor onboarding={onboarding === "1"} returnTo={addressReturnFrom(returnTo)} />
}

export default function NewAddressPage({ searchParams }: PageProps<"/[locale]/account/addresses/new">) {
  return (
    <Suspense>
      <NewAddressRoute searchParams={searchParams} />
    </Suspense>
  )
}
