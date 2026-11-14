import { createHash } from "node:crypto";

import { DECISION_REASON_MAX_LENGTH, DECISION_REASON_MIN_LENGTH, plainText, type AccountType, type ShopStatus } from "@chicman/shared";

import type { Prisma } from "../../generated/prisma/client.js";
import type { PrismaClient } from "../../lib/prisma.js";
import { lockShopById } from "./shop.service.js";

/**
 * Operator-only transfer of a shop to another Seller account (AT-1, Q8:
 * "through an audited, explicitly approved operation"). No API route.
 *
 * The dry run (`planShopTransfer`) describes the transfer and gives a digest;
 * `applyShopTransfer` writes only that exact transfer, after checking it
 * again under the shop row lock. It changes `Shop.ownerUserId` and appends one
 * `ShopOwnershipEvent`, nothing else: products, orders, status, logo, and the
 * audit history (whose actors stay who they were) are untouched.
 */

export interface ShopTransferInput {
  shopId: string;
  /** The Supabase identity of the target Seller account. */
  toSupabaseUserId: string;
  reason: string;
  note?: string;
}

export interface ShopTransferPlan {
  shop: { id: string; shopName: string; status: ShopStatus; products: number; shopOrders: number };
  from: { userId: string; supabaseUserId: string; accountType: AccountType };
  to: { userId: string; supabaseUserId: string };
  reason: string;
  note: string | null;
  /** SHA-256 of what is transferred, from whom, to whom, and why: the operator approves this exact value. */
  digest: string;
}

export type ShopTransferRefusal =
  | "invalid-reason"
  | "invalid-note"
  | "shop-not-found"
  | "target-not-found"
  | "target-not-seller"
  | "target-has-shop"
  | "same-owner"
  /** Pending or confirmed shop orders: their confirmation and delivery would change hands mid-way. */
  | "open-orders";

type Refused = { state: "refused"; reason: ShopTransferRefusal; openOrders?: number };

export type ShopTransferPlanOutcome = { state: "ready"; plan: ShopTransferPlan } | Refused;

export type ShopTransferApplyOutcome = Refused | { state: "transferred"; plan: ShopTransferPlan } | { state: "digest-mismatch"; plan: ShopTransferPlan };

const transferReason = plainText(DECISION_REASON_MIN_LENGTH, DECISION_REASON_MAX_LENGTH);
const operatorNote = plainText(1, 1000, { multiline: true });

type Db = Prisma.TransactionClient | PrismaClient;

async function buildPlan(db: Db, input: ShopTransferInput): Promise<ShopTransferPlanOutcome> {
  const reason = transferReason.safeParse(input.reason);
  if (!reason.success) return { state: "refused", reason: "invalid-reason" };
  const note = input.note === undefined ? null : operatorNote.safeParse(input.note);
  if (note !== null && !note.success) return { state: "refused", reason: "invalid-note" };

  const shop = await db.shop.findUnique({
    where: { id: input.shopId },
    select: {
      id: true,
      shopName: true,
      status: true,
      owner: { select: { id: true, supabaseUserId: true, accountType: true } },
      _count: { select: { products: true, shopOrders: true } },
    },
  });
  if (shop === null) return { state: "refused", reason: "shop-not-found" };
  const target = await db.user.findUnique({ where: { supabaseUserId: input.toSupabaseUserId }, select: { id: true, accountType: true, shop: { select: { id: true } } } });
  if (target === null) return { state: "refused", reason: "target-not-found" };
  if (target.id === shop.owner.id) return { state: "refused", reason: "same-owner" };
  if (target.accountType !== "SELLER") return { state: "refused", reason: "target-not-seller" };
  if (target.shop !== null) return { state: "refused", reason: "target-has-shop" };
  const openOrders = await db.shopOrder.count({ where: { shopId: shop.id, status: { in: ["PENDING", "CONFIRMED"] } } });
  if (openOrders > 0) return { state: "refused", reason: "open-orders", openOrders };

  const described = {
    shopId: shop.id,
    status: shop.status,
    fromUserId: shop.owner.id,
    toUserId: target.id,
    reason: reason.data,
    note: note?.data ?? null,
  };
  return {
    state: "ready",
    plan: {
      shop: { id: shop.id, shopName: shop.shopName, status: shop.status, products: shop._count.products, shopOrders: shop._count.shopOrders },
      from: { userId: shop.owner.id, supabaseUserId: shop.owner.supabaseUserId, accountType: shop.owner.accountType },
      to: { userId: target.id, supabaseUserId: input.toSupabaseUserId },
      reason: described.reason,
      note: described.note,
      digest: createHash("sha256").update(JSON.stringify(described)).digest("hex"),
    },
  };
}

/** Dry run: what the transfer would do, or why it is refused. Read-only. */
export function planShopTransfer(prisma: PrismaClient, input: ShopTransferInput): Promise<ShopTransferPlanOutcome> {
  return buildPlan(prisma, input);
}

/**
 * Writes the approved transfer in one transaction: the shop row is locked
 * first, the plan is rebuilt under the lock, and only if its digest is the
 * approved one are the owner changed (the database trigger requires a Seller)
 * and the `ShopOwnershipEvent` appended.
 */
export function applyShopTransfer(prisma: PrismaClient, input: ShopTransferInput, approvedDigest: string): Promise<ShopTransferApplyOutcome> {
  return prisma.$transaction(async (tx) => {
    if ((await lockShopById(tx, input.shopId)) === null) return { state: "refused", reason: "shop-not-found" };
    const outcome = await buildPlan(tx, input);
    if (outcome.state !== "ready") return outcome;
    const { plan } = outcome;
    if (plan.digest !== approvedDigest) return { state: "digest-mismatch", plan };
    await tx.shop.update({ where: { id: plan.shop.id }, data: { ownerUserId: plan.to.userId } });
    await tx.shopOwnershipEvent.create({
      data: { shopId: plan.shop.id, fromUserId: plan.from.userId, toUserId: plan.to.userId, reason: plan.reason, operatorNote: plan.note },
    });
    return { state: "transferred", plan };
  });
}
