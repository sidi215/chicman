import { Suspense } from "react"

import { AddressEditor } from "@/features/addresses/components/address-screens"
import { localizedMetadata } from "@/lib/page-metadata"

export const generateMetadata = localizedMetadata({ fr: "Modifier l'adresse · Chicman", ar: "تعديل العنوان · شيكمان" })

async function EditAddressRoute({ params }: { params: Promise<{ addressId: string }> }) {
  const { addressId } = await params
  return <AddressEditor addressId={addressId} />
}

export default function EditAddressPage({ params }: PageProps<"/[locale]/account/addresses/[addressId]">) {
  return (
    <Suspense>
      <EditAddressRoute params={params} />
    </Suspense>
  )
}
