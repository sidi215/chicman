"use client"

import { useCallback, useSyncExternalStore } from "react"
import {
  DEFAULT_THEME_PREFERENCE,
  THEME_CHANGE_EVENT,
  readThemePreference,
  syncThemePreferenceFromStorage,
  writeThemePreference,
  type ThemePreference,
} from "@/lib/theme"

function subscribe(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (syncThemePreferenceFromStorage(event)) onChange()
  }
  window.addEventListener(THEME_CHANGE_EVENT, onChange)
  window.addEventListener("storage", onStorage)
  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, onChange)
    window.removeEventListener("storage", onStorage)
  }
}

/** Current theme preference and a setter that persists it on the device. */
export function useThemePreference(): [ThemePreference, (value: ThemePreference) => void] {
  const preference = useSyncExternalStore(
    subscribe,
    readThemePreference,
    () => DEFAULT_THEME_PREFERENCE
  )
  const setPreference = useCallback((value: ThemePreference) => {
    writeThemePreference(value)
  }, [])
  return [preference, setPreference]
}
