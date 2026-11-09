import { randomBytes } from "node:crypto";

/** Crockford base32, without the letters that read like digits (I, L, O, U). */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const LENGTH = 10;

/**
 * A customer-facing order reference, such as `CM-7K3QX9D2RB` (spec 11). Random
 * (50 bits), so it reveals neither order volume nor sequence. Uniqueness is
 * enforced by the database.
 */
export function newOrderReference(): string {
  const bytes = randomBytes(LENGTH);
  let code = "";
  for (const byte of bytes) code += ALPHABET[byte % ALPHABET.length];
  return `CM-${code}`;
}
