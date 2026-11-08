import { useLocale } from "@/lib/locale-provider"

import { AUTH_MESSAGES, type AuthMessages } from "./messages"

/** Auth texts for the current locale. */
export function useAuthMessages(): AuthMessages {
  return AUTH_MESSAGES[useLocale()]
}
