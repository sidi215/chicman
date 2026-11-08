
import { UpdatePasswordForm } from "@/features/auth/components/update-password-form"
import { localizedMetadata } from "@/lib/page-metadata"

export const generateMetadata = localizedMetadata({ fr: "Nouveau mot de passe · Chicman", ar: "كلمة مرور جديدة · شيكمان" }, { robots: { index: false, follow: false } })

export default function UpdatePasswordPage() {
  return <UpdatePasswordForm />
}
