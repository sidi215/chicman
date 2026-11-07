import { DEFAULT_LOCALE } from "@/lib/locale"

import { AUTH_MESSAGES, type AuthMessages } from "./messages"

/** Auth texts for the current locale (the default until locale selection exists). */
export function useAuthMessages(): AuthMessages {
  return AUTH_MESSAGES[DEFAULT_LOCALE]
}
