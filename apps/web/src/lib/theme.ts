/**
 * Theme preference (System / Light / Dark), persisted on the device.
 *
 * - `system` (default) follows the OS `prefers-color-scheme`.
 * - The preference is stored in localStorage under THEME_STORAGE_KEY.
 * - The resolved theme is applied as the `.dark` class on <html> by the
 *   inline script from `themeInitScript`, which runs before first paint and
 *   keeps listening for OS changes, other tabs, and in-page updates.
 */

export const THEME_PREFERENCES = ["system", "light", "dark"] as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export const DEFAULT_THEME_PREFERENCE: ThemePreference = "system";

export const THEME_STORAGE_KEY = "chicman-theme";

/** Dispatched on window after the preference changes in this tab. */
export const THEME_CHANGE_EVENT = "chicman-theme-change";

export function isThemePreference(value: unknown): value is ThemePreference {
  return (THEME_PREFERENCES as readonly unknown[]).includes(value);
}

/**
 * The preference selected in this page session. It is the source of truth
 * for reads, so a selection survives when localStorage is unavailable
 * (private mode, blocked storage, quota errors).
 */
let sessionPreference: ThemePreference | null = null;

function readStoredPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : DEFAULT_THEME_PREFERENCE;
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
}

export function readThemePreference(): ThemePreference {
  return sessionPreference ?? readStoredPreference();
}

let storageSyncRegistered = false;

/** Keeps sessionPreference in step with other tabs once it is in use. */
function ensureStorageSync(): void {
  if (storageSyncRegistered) return;
  storageSyncRegistered = true;
  window.addEventListener("storage", (event) => {
    syncThemePreferenceFromStorage(event);
  });
}

export function writeThemePreference(preference: ThemePreference): void {
  sessionPreference = preference;
  ensureStorageSync();
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage unavailable: the selection is kept for this page session.
  }
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: preference }));
}

/** Adopts a preference written by another tab (`storage` event). */
export function syncThemePreferenceFromStorage(event: StorageEvent): boolean {
  if (event.key !== THEME_STORAGE_KEY) return false;
  sessionPreference = isThemePreference(event.newValue) ? event.newValue : null;
  return true;
}

/** Test-only: forget the session preference. */
export function resetThemePreferenceForTests(): void {
  sessionPreference = null;
  storageSyncRegistered = false;
}

/**
 * Inline <script> for the root layout <head>: applies the theme before first
 * paint and keeps it in sync with OS, other-tab, and in-page changes.
 *
 * Written as literal ES5 source (not `fn.toString()`), so no compiler can
 * inject helpers that the inline script cannot resolve.
 *
 * It keeps its own in-memory copy of the selection (updated by in-page
 * change events and other tabs' storage events), so an explicit Light or
 * Dark choice is never replaced by an OS color-scheme change, even when
 * localStorage cannot be written.
 */
export const themeInitScript = `(function () {
  var storageKey = ${JSON.stringify(THEME_STORAGE_KEY)};
  var changeEvent = ${JSON.stringify(THEME_CHANGE_EVENT)};
  var fallback = ${JSON.stringify(DEFAULT_THEME_PREFERENCE)};
  var media = window.matchMedia("(prefers-color-scheme: dark)");
  var selected = null;
  function isPreference(value) {
    return value === "light" || value === "dark" || value === "system";
  }
  function read() {
    if (selected) return selected;
    try {
      var value = window.localStorage.getItem(storageKey);
      return isPreference(value) ? value : fallback;
    } catch (error) {
      return fallback;
    }
  }
  function apply() {
    var preference = read();
    var dark = preference === "dark" || (preference === "system" && media.matches);
    document.documentElement.classList.toggle("dark", dark);
  }
  apply();
  media.addEventListener("change", apply);
  window.addEventListener("storage", function (event) {
    if (event.key !== storageKey) return;
    selected = isPreference(event.newValue) ? event.newValue : null;
    apply();
  });
  window.addEventListener(changeEvent, function (event) {
    if (isPreference(event.detail)) selected = event.detail;
    apply();
  });
})();`;
