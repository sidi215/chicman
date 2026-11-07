/**
 * Supported UI locales and their text direction.
 * French (LTR) is the default; Arabic renders RTL.
 * Locale selection (routing, translations) is introduced by the i18n feature;
 * until then the app renders in the default locale.
 */
export const LOCALE_DIRECTION = { fr: "ltr", ar: "rtl" } as const;

export type Locale = keyof typeof LOCALE_DIRECTION;

export const DEFAULT_LOCALE: Locale = "fr";
