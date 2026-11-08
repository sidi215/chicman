
import { RegisterForm } from "@/features/auth/components/register-form"
import { localizedMetadata } from "@/lib/page-metadata"

export const generateMetadata = localizedMetadata({ fr: "Créer un compte · Chicman", ar: "إنشاء حساب · شيكمان" })

export default function RegisterPage() {
  return <RegisterForm />
}
