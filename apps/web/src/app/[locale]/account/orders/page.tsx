import { CustomerOrderList } from "@/features/orders/components/customer-orders"
import { localizedMetadata } from "@/lib/page-metadata"

export const generateMetadata = localizedMetadata({ fr: "Mes commandes · Chicman", ar: "طلباتي · شيكمان" })

/** `/account/orders` (spec 11): the customer's own orders. */
export default function AccountOrdersPage() {
  return <CustomerOrderList />
}
