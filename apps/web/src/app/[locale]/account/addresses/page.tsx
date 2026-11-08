
import { AddressList } from "@/features/addresses/components/address-screens"
import { localizedMetadata } from "@/lib/page-metadata"

export const generateMetadata = localizedMetadata({ fr: "Mes adresses · Chicman", ar: "عناويني · شيكمان" })

export default function AddressesPage() {
  return <AddressList />
}
