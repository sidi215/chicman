
import { ProfileSettings } from "@/features/profile/components/profile-settings"
import { localizedMetadata } from "@/lib/page-metadata"

export const generateMetadata = localizedMetadata({ fr: "Paramètres du profil · Chicman", ar: "إعدادات الملف الشخصي · شيكمان" })

export default function ProfileSettingsPage() {
  return <ProfileSettings />
}
