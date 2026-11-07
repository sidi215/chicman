import type { Metadata } from "next"

import { ProfileSettings } from "@/features/profile/components/profile-settings"

export const metadata: Metadata = { title: "Paramètres du profil · Chicman" }

export default function ProfileSettingsPage() {
  return <ProfileSettings />
}
