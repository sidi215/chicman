import { normalizePhoneNumber } from "@chicman/shared";

import type { PrismaClient } from "../../lib/prisma.js";

/**
 * Operator-only creation of a Seller account **without a shop** (AT-1,
 * section 11.3, Q8): the target of an approved shop transfer. Normal sellers
 * register publicly, and their setup creates the shop with the account. There
 * is no API route for this.
 */
export type SellerProvisionOutcome =
  | { state: "provisioned"; userId: string }
  | { state: "account-exists"; accountType: string }
  | { state: "buyer-intent" }
  | { state: "invalid-phone" };

/**
 * Creates the Seller account (with its personal profile; the phone is
 * required for sellers, Q3) for a Supabase identity that has no account yet.
 * Never converts an existing account. An identity that registered as a buyer
 * (a `BUYER` intent) is refused: that person chose to buy. A `SELLER` intent,
 * if any, is marked consumed, as account setup would.
 */
export async function provisionSellerWithoutShop(prisma: PrismaClient, supabaseUserId: string, rawPhone: string): Promise<SellerProvisionOutcome> {
  const phone = normalizePhoneNumber(rawPhone);
  if (phone === null) return { state: "invalid-phone" };
  return prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { supabaseUserId }, select: { accountType: true } });
    if (existing !== null) return { state: "account-exists", accountType: existing.accountType };
    const intent = await tx.registrationIntent.findUnique({ where: { supabaseUserId }, select: { accountType: true } });
    if (intent?.accountType === "BUYER") return { state: "buyer-intent" };

    const user = await tx.user.create({ data: { supabaseUserId, accountType: "SELLER" }, select: { id: true } });
    await tx.customerProfile.create({
      data: {
        userId: user.id,
        phone,
        phoneChanges: { create: { actorUserId: user.id, changeType: "ACCOUNT_SETUP", previousPhone: null, newPhone: phone } },
      },
    });
    if (intent !== null) await tx.registrationIntent.update({ where: { supabaseUserId }, data: { consumedAt: new Date() } });
    return { state: "provisioned", userId: user.id };
  });
}
