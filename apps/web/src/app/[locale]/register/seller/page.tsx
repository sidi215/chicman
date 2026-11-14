import { RegisterForm } from "@/features/auth/components/register-form"
import { localizedMetadata } from "@/lib/page-metadata"

export const generateMetadata = localizedMetadata({ fr: "Créer un compte vendeur · Chicman", ar: "إنشاء حساب بائع · شيكمان" })

/** `/register/seller` (AT-1, web only): seller registration, reached from "Vendre sur Chicman" (Q10). */
export default function SellerRegisterPage() {
  return <RegisterForm accountType="SELLER" />
}
