import { Suspense } from "react"

import { addressReturnFrom } from "@/features/addresses/address-return"
import { AddressEditor } from "@/features/addresses/components/address-screens"
import { AccountGate } from "@/features/auth/components/account-gate"
import { localizedMetadata } from "@/lib/page-metadata"

export const generateMetadata = localizedMetadata({ fr: "Modifier l'adresse · Chicman", ar: "تعديل العنوان · شيكمان" })

async function EditAddressRoute({
  params,
  searchParams,
}: {
  params: Promise<{ addressId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { addressId } = await params
  const { returnTo } = await searchParams
  return (
    <AccountGate area="buyer">
      <AddressEditor addressId={addressId} returnTo={addressReturnFrom(returnTo)} />
    </AccountGate>
  )
}

export default function EditAddressPage({ params, searchParams }: PageProps<"/[locale]/account/addresses/[addressId]">) {
  return (
    <Suspense>
      <EditAddressRoute params={params} searchParams={searchParams} />
    </Suspense>
  )
}
