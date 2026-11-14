import { DECISION_REASON_MAX_LENGTH, DECISION_REASON_MIN_LENGTH, normalizePhoneNumber, plainText } from "@chicman/shared";

import type { PrismaClient } from "../../lib/prisma.js";

/**
 * Operator-only administrator management (AT-1, section 6; Q3, Q7). There is
 * no API route for any of it. Called by `scripts/provision-admin.ts` and
 * `scripts/deactivate-admin.ts`.
 */

export type ProvisionOutcome =
  | { state: "provisioned"; userId: string }
  | { state: "account-exists"; accountType: string }
  | { state: "invalid-phone" };

/**
 * Creates an Administrator account for a Supabase identity that has no
 * account yet (created or invited by the operator, email confirmed). Never
 * converts a Buyer or Seller. Any registration intent of the identity is
 * deleted: it can no longer lead to a public setup. The personal phone is
 * optional for administrators (Q3).
 */
export async function provisionAdministrator(prisma: PrismaClient, supabaseUserId: string, options: { phone?: string } = {}): Promise<ProvisionOutcome> {
  let phone: string | null = null;
  if (options.phone !== undefined) {
    phone = normalizePhoneNumber(options.phone);
    if (phone === null) return { state: "invalid-phone" };
  }
  return prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { supabaseUserId }, select: { accountType: true } });
    if (existing !== null) return { state: "account-exists", accountType: existing.accountType };
    await tx.registrationIntent.deleteMany({ where: { supabaseUserId } });
    const user = await tx.user.create({ data: { supabaseUserId, accountType: "ADMIN" }, select: { id: true } });
    await tx.customerProfile.create({
      data: {
        userId: user.id,
        phone,
        ...(phone === null ? {} : { phoneChanges: { create: { actorUserId: user.id, changeType: "ACCOUNT_SETUP", previousPhone: null, newPhone: phone } } }),
      },
    });
    return { state: "provisioned", userId: user.id };
  });
}

const deactivationReason = plainText(DECISION_REASON_MIN_LENGTH, DECISION_REASON_MAX_LENGTH);
const operatorNote = plainText(1, 1000, { multiline: true });

export type DeactivationOutcome =
  | { state: "deactivated" }
  | { state: "already-deactivated" }
  | { state: "not-found" }
  | { state: "not-admin" }
  | { state: "invalid-reason" }
  | { state: "invalid-note" };

/**
 * Deactivates an administrator's administrative access (Q7): the timestamp
 * and an `AdminAccessEvent` in one transaction. The account stays `ADMIN`; it
 * is never converted. Every administrative route refuses it from its next
 * request. No reactivation is provided (not decided).
 */
export async function deactivateAdministrator(
  prisma: PrismaClient,
  supabaseUserId: string,
  input: { reason: string; note?: string },
): Promise<DeactivationOutcome> {
  const reason = deactivationReason.safeParse(input.reason);
  if (!reason.success) return { state: "invalid-reason" };
  const note = input.note === undefined ? null : operatorNote.safeParse(input.note);
  if (note !== null && !note.success) return { state: "invalid-note" };
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { supabaseUserId }, select: { id: true, accountType: true } });
    if (user === null) return { state: "not-found" };
    if (user.accountType !== "ADMIN") return { state: "not-admin" };
    const { count } = await tx.user.updateMany({ where: { id: user.id, adminAccessDeactivatedAt: null }, data: { adminAccessDeactivatedAt: new Date() } });
    if (count === 0) return { state: "already-deactivated" };
    await tx.adminAccessEvent.create({ data: { userId: user.id, action: "DEACTIVATED", reason: reason.data, operatorNote: note?.data ?? null } });
    return { state: "deactivated" };
  });
}
