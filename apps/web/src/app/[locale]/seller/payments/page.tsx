import { SellerPaymentSummaryPage } from "@/features/orders/components/seller-payment-summary"
import { SellerAreaGate } from "@/features/seller/components/seller-area-gate"
import { localizedMetadata } from "@/lib/page-metadata"

export const generateMetadata = localizedMetadata({ fr: "Encaissements · Chicman", ar: "التحصيلات · شيكمان" })

/** `/seller/payments` (spec 13, section 9; web only: O1): the seller's collection summary. */
export default function SellerPaymentsPage() {
  return (
    <SellerAreaGate area="payments">
      <SellerPaymentSummaryPage />
    </SellerAreaGate>
  )
}
