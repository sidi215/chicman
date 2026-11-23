import { Suspense } from "react"

import { AccountGate } from "@/features/auth/components/account-gate"
import { AdminCaseScreen } from "@/features/moderation/components/admin-moderation"
import { localizedMetadata } from "@/lib/page-metadata"

export const generateMetadata = localizedMetadata({ fr: "Dossier de modération · Administration · Chicman", ar: "ملف الإشراف · الإدارة · شيكمان" })

async function CaseRoute({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params
  return (
    <AccountGate area="admin">
      <AdminCaseScreen caseId={caseId} />
    </AccountGate>
  )
}

/** `/admin/moderation/[caseId]` (spec 19): reports, snapshot, history, open orders, and the actions. */
export default function AdminCasePage({ params }: PageProps<"/[locale]/admin/moderation/[caseId]">) {
  return (
    <Suspense>
      <CaseRoute params={params} />
    </Suspense>
  )
}
