
import { LoginForm } from "@/features/auth/components/login-form"
import { localizedMetadata } from "@/lib/page-metadata"

export const generateMetadata = localizedMetadata({ fr: "Connexion · Chicman", ar: "تسجيل الدخول · شيكمان" })

export default function LoginPage() {
  return <LoginForm />
}
