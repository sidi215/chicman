import { Suspense } from "react"

import { addressIdFromQuery } from "@/features/checkout/checkout-logic"
import { CheckoutPage } from "@/features/checkout/components/checkout-page"
import { localizedMetadata } from "@/lib/page-metadata"

export const generateMetadata = localizedMetadata({ fr: "Commande · Chicman", ar: "الطلب · شيكمان" }, { robots: { index: false, follow: false } })

async function CheckoutRoute({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { addressId } = await searchParams
  return <CheckoutPage addressId={addressIdFromQuery(addressId)} />
}

/** `/checkout` (spec 10). In the storefront group so it shares the layout's cart. Not indexed. */
export default function CheckoutRoutePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <Suspense>
      <CheckoutRoute searchParams={searchParams} />
    </Suspense>
  )
}
