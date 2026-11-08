
import { ForgotPasswordForm } from "@/features/auth/components/forgot-password-form"
import { localizedMetadata } from "@/lib/page-metadata"

export const generateMetadata = localizedMetadata({ fr: "Mot de passe oublié · Chicman", ar: "نسيت كلمة المرور · شيكمان" })

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />
}
