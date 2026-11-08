import type { Metadata } from "next"
import { Suspense } from "react"

import { AddressEditor } from "@/features/addresses/components/address-screens"

export const metadata: Metadata = { title: "Modifier l'adresse · Chicman" }

async function EditAddressRoute({ params }: { params: Promise<{ addressId: string }> }) {
  const { addressId } = await params
  return <AddressEditor addressId={addressId} />
}

export default function EditAddressPage({ params }: PageProps<"/account/addresses/[addressId]">) {
  return (
    <Suspense>
      <EditAddressRoute params={params} />
    </Suspense>
  )
}
