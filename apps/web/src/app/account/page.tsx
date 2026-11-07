import type { Metadata } from "next"

import { AccountPanel } from "@/features/auth/components/account-panel"

export const metadata: Metadata = { title: "Mon compte · Chicman" }

export default function AccountPage() {
  return <AccountPanel />
}
