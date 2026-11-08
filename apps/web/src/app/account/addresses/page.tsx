import type { Metadata } from "next"

import { AddressList } from "@/features/addresses/components/address-screens"

export const metadata: Metadata = { title: "Mes adresses · Chicman" }

export default function AddressesPage() {
  return <AddressList />
}
