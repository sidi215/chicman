/** Default country calling code (Mauritania). */
export const DEFAULT_COUNTRY_CODE = "222";

/** Mauritanian national numbers have 8 digits. */
const NATIONAL_NUMBER_LENGTH = 8;

const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * Normalizes user-entered phone input to E.164 (`+` followed by 8–15 digits).
 *
 * Spaces, dots, dashes, and parentheses are ignored. `00` is read as `+`.
 * An 8-digit national number gets the Mauritanian code (+222).
 * Returns `null` for anything else.
 */
export function normalizePhoneNumber(input: string): string | null {
  const compact = input.trim().replace(/[\s.\-()]/g, "");
  let candidate: string;
  if (compact.startsWith("+")) {
    candidate = compact;
  } else if (compact.startsWith("00")) {
    candidate = `+${compact.slice(2)}`;
  } else if (/^\d+$/.test(compact) && compact.length === NATIONAL_NUMBER_LENGTH) {
    candidate = `+${DEFAULT_COUNTRY_CODE}${compact}`;
  } else {
    return null;
  }
  return E164.test(candidate) ? candidate : null;
}

/** True for a value already normalized to E.164 (`+` and 8–15 digits). */
export function isE164PhoneNumber(value: string): boolean {
  return E164.test(value);
}
