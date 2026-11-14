/** Interface languages (`CustomerProfile.preferredLocale`). */
export const LOCALES = ["fr", "ar"] as const;
export type Locale = (typeof LOCALES)[number];

/** Bounds of `fullName` (spec 04). */
export const FULL_NAME_MAX_LENGTH = 100;

// AT-1: the profile contracts (`AccountProfile`, `AccountProfileResponse`) are in
// `accounts/account-types.ts`, for every account type.
