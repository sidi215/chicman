import { localeCookie, switchedHref, type Locale } from "./locale"

/**
 * Language synchronization (web). The profile's `preferredLocale` decides once
 * per browser session, when a signed-in user is first seen; afterwards every
 * change of language is written to the profile. This marker records that the
 * session is already in step, so a request still in flight, or one that failed,
 * cannot change the language back under the user.
 */
const SYNCED_KEY = "chicman_locale_synced"

type MarkerStore = Pick<Storage, "getItem" | "setItem" | "removeItem">

function sessionStore(): MarkerStore | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function attempt(action: () => void): void {
  try {
    action()
  } catch {
    // Storage can refuse writes. The session then syncs again on the next load.
  }
}

export function isLocaleSynced(userId: string, store: MarkerStore | null = sessionStore()): boolean {
  try {
    return store?.getItem(SYNCED_KEY) === userId
  } catch {
    return false
  }
}

export function markLocaleSynced(userId: string, store: MarkerStore | null = sessionStore()): void {
  attempt(() => store?.setItem(SYNCED_KEY, userId))
}

export function clearLocaleSynced(store: MarkerStore | null = sessionStore()): void {
  attempt(() => store?.removeItem(SYNCED_KEY))
}

/** Saves the language on this device and reloads the page in it. */
export function goToLocale(locale: Locale): void {
  const { protocol, pathname, search } = window.location
  document.cookie = localeCookie(locale, protocol === "https:")
  window.location.assign(switchedHref(pathname, search, locale))
}
