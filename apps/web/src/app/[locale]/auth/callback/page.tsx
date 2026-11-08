
import { CallbackView } from "@/features/auth/components/callback-view"
import { localizedMetadata } from "@/lib/page-metadata"

// No-referrer and a strict CSP are set for this route in next.config.ts.
export const generateMetadata = localizedMetadata({ fr: "Vérification · Chicman", ar: "التحقق · شيكمان" }, { robots: { index: false, follow: false } })

export default function AuthCallbackPage() {
  return <CallbackView />
}
