import type { AccountType, Role } from "@chicman/shared";

import type { Prisma } from "../../generated/prisma/client.js";
import type { PrismaClient } from "../../lib/prisma.js";
import { buildClassificationPlan, type AccountSnapshot, type ClassificationPlan } from "./account-classification.js";

type Db = Pick<PrismaClient, "user">;

/**
 * Reads every account with what classification needs. Read-only.
 * `accountTypeColumn: false` reads a database where the AT-1 expand migration
 * is not applied yet (dry run only): every type is then reported as unset.
 */
export async function loadAccountSnapshots(db: Db, options: { accountTypeColumn?: boolean } = {}): Promise<AccountSnapshot[]> {
  const withType = options.accountTypeColumn ?? true;
  const users = await db.user.findMany({
    orderBy: { id: "asc" },
    select: {
      id: true,
      supabaseUserId: true,
      accountType: withType,
      roles: { select: { role: true } },
      customerProfile: { select: { id: true } },
      shop: { select: { status: true, _count: { select: { products: true, shopOrders: true } } } },
      cart: { select: { _count: { select: { items: true } } } },
      _count: { select: { orders: true, customerAddresses: true, favorites: true, notifications: true } },
    },
  });
  return users.map((user) => ({
    userId: user.id,
    supabaseUserId: user.supabaseUserId,
    roles: user.roles.map(({ role }) => role as Role),
    accountType: ((user as { accountType?: AccountType | null }).accountType ?? null) as AccountType | null,
    hasProfile: user.customerProfile !== null,
    shop: user.shop === null ? null : { status: user.shop.status, products: user.shop._count.products, shopOrders: user.shop._count.shopOrders },
    buyer: {
      orders: user._count.orders,
      addresses: user._count.customerAddresses,
      cartItems: user.cart?._count.items ?? 0,
      favorites: user._count.favorites,
    },
    notifications: user._count.notifications,
  }));
}

export type ApplyOutcome =
  | { state: "applied"; written: number; plan: ClassificationPlan }
  | { state: "blocked"; plan: ClassificationPlan }
  | { state: "digest-mismatch"; plan: ClassificationPlan };

/**
 * Writes `User.accountType` for the reviewed plan, in one transaction. The
 * plan is rebuilt inside the transaction and written only if its digest is
 * the one the owner approved and no account is blocked. Each write is
 * conditional on the type still being unset, so nothing already typed
 * changes (the database trigger forbids it anyway). Only `accountType` is
 * written: no role, shop, order, or other record changes.
 */
export async function applyClassificationPlan(prisma: PrismaClient, approvedDigest: string): Promise<ApplyOutcome> {
  return prisma.$transaction((tx) => applyClassificationPlanIn(tx, approvedDigest), { isolationLevel: "Serializable" });
}

/** The body of `applyClassificationPlan`, inside the caller's transaction. */
export async function applyClassificationPlanIn(tx: Prisma.TransactionClient, approvedDigest: string): Promise<ApplyOutcome> {
  const plan = buildClassificationPlan(await loadAccountSnapshots(tx));
  if (plan.blocked > 0) return { state: "blocked", plan };
  if (plan.digest !== approvedDigest) return { state: "digest-mismatch", plan };
  let written = 0;
  for (const write of plan.writes) {
    // Raw SQL: the column is NOT NULL once the contract migration runs, so the client types it as required.
    const count = await tx.$executeRaw`
      UPDATE "User" SET "accountType" = ${write.accountType}::"AccountType" WHERE "id" = ${write.userId}::uuid AND "accountType" IS NULL`;
    if (count !== 1) throw new Error("an account changed during classification; nothing was written");
    written += count;
  }
  return { state: "applied", written, plan };
}
