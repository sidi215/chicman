import { Suspense } from "react"

import { addressReturnFrom } from "@/features/addresses/address-return"
import { AddressList } from "@/features/addresses/components/address-screens"
import { AccountGate } from "@/features/auth/components/account-gate"
import { localizedMetadata } from "@/lib/page-metadata"

export const generateMetadata = localizedMetadata({ fr: "Mes adresses · Chicman", ar: "عناويني · شيكمان" })

async function AddressesRoute({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { select } = await searchParams
  return (
    <AccountGate area="buyer">
      <AddressList selectFor={addressReturnFrom(select)} />
    </AccountGate>
  )
}

export default function AddressesPage({ searchParams }: PageProps<"/[locale]/account/addresses">) {
  return (
    <Suspense>
      <AddressesRoute searchParams={searchParams} />
    </Suspense>
  )
}
