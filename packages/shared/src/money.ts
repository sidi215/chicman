import { z } from "zod";

/** Up to 10 integer digits and 2 decimals, the range of `DECIMAL(12, 2)`. */
export const MONEY_PATTERN = /^(0|[1-9][0-9]{0,9})(\.[0-9]{1,2})?$/;

/** "1500" → "1500.00", "150.5" → "150.50". Only for strings matching `MONEY_PATTERN`. */
export function normalizeMoney(value: string): string {
  const [whole = "0", fraction = ""] = value.split(".");
  return `${whole}.${fraction.padEnd(2, "0")}`;
}

/**
 * An amount in MRU that may be zero, as a decimal string normalized to two
 * decimals. JSON numbers are refused, so an amount never passes through
 * floating point.
 *
 * Used where `0.00` is meaningful: a free delivery fee (spec 06, D2) and the
 * figures a customer was shown at checkout (spec 10).
 */
export const moneyAmountSchema = z.string().max(13).regex(MONEY_PATTERN).transform(normalizeMoney);
