import type { Metadata } from "next"

import { CallbackView } from "@/features/auth/components/callback-view"

// No-referrer and a strict CSP are set for this route in next.config.ts.
export const metadata: Metadata = { title: "Vérification · Chicman", robots: { index: false, follow: false } }

export default function AuthCallbackPage() {
  return <CallbackView />
}
