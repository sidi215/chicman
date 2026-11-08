import type { Metadata } from "next"

import { AdminShopList } from "@/features/admin/components/admin-shops"

export const metadata: Metadata = { title: "Boutiques · Administration · Chicman" }

export default function AdminShopsPage() {
  return <AdminShopList />
}
