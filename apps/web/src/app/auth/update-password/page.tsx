import type { Metadata } from "next"

import { UpdatePasswordForm } from "@/features/auth/components/update-password-form"

export const metadata: Metadata = { title: "Nouveau mot de passe · Chicman", robots: { index: false, follow: false } }

export default function UpdatePasswordPage() {
  return <UpdatePasswordForm />
}
