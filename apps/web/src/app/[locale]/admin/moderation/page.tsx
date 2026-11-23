import { AccountGate } from "@/features/auth/components/account-gate"
import { AdminModerationQueue } from "@/features/moderation/components/admin-moderation"
import { localizedMetadata } from "@/lib/page-metadata"

export const generateMetadata = localizedMetadata({ fr: "Modération · Administration · Chicman", ar: "الإشراف · الإدارة · شيكمان" })

/** `/admin/moderation` (spec 19): the queue, the administrator's entry point (no admin inbox, O6.1). */
export default function AdminModerationPage() {
  return (
    <AccountGate area="admin">
      <AdminModerationQueue />
    </AccountGate>
  )
}
