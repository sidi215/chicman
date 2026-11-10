import type { DeliveryStatus } from "@chicman/shared";

import type { Prisma } from "../../generated/prisma/client.js";

/**
 * The delivery record (spec 12): creation by spec 11's confirmation
 * transaction, cancellation when the shop order is cancelled before dispatch,
 * and the lock both share with the delivery lifecycle (`delivery-lifecycle.ts`).
 */

export interface LockedDelivery {
  id: string;
  status: DeliveryStatus;
  autoCloseAt: Date | null;
  closedAt: Date | null;
}

/** Statuses from which a cancelled shop order cancels its delivery (spec 12, section 4). */
export const CANCELLABLE_DELIVERY_STATUSES: readonly DeliveryStatus[] = ["PENDING", "ASSIGNED"];

/**
 * A delivery under way: out for delivery, or failed and not closed (D8). The
 * only deliveries the owner of a suspended shop may still finish.
 */
export const isDeliveryInProgress = (delivery: { status: DeliveryStatus; closedAt: Date | null }): boolean =>
  delivery.status === "OUT_FOR_DELIVERY" || (delivery.status === "FAILED" && delivery.closedAt === null);

/** Locks the shop order's delivery, after the shop order (spec 12 lock order). `null` before confirmation. */
export async function lockDelivery(tx: Prisma.TransactionClient, shopOrderId: string): Promise<LockedDelivery | null> {
  const rows = await tx.$queryRaw<LockedDelivery[]>`
    SELECT "id", "status"::text AS "status", "autoCloseAt", "closedAt" FROM "Delivery" WHERE "shopOrderId" = ${shopOrderId}::uuid FOR UPDATE`;
  return rows[0] ?? null;
}

/**
 * Creates the delivery as `PENDING` (spec 12), in the confirmation
 * transaction only. One per shop order (unique key).
 */
export async function createDelivery(tx: Prisma.TransactionClient, shopOrderId: string, at: Date): Promise<void> {
  await tx.delivery.create({
    data: {
      shopOrderId,
      status: "PENDING",
      createdAt: at,
      events: { create: { fromStatus: null, toStatus: "PENDING", actorType: "SYSTEM", createdAt: at } },
    },
  });
}

/**
 * Cancels a delivery that has not left (`PENDING` or `ASSIGNED`), in the
 * transaction of the shop order's cancellation. Returns `false`, writing
 * nothing, for any other status: the caller refuses the cancellation.
 */
export async function cancelDelivery(tx: Prisma.TransactionClient, delivery: LockedDelivery, at: Date): Promise<boolean> {
  if (!CANCELLABLE_DELIVERY_STATUSES.includes(delivery.status)) return false;
  const updated = await tx.delivery.updateMany({
    where: { id: delivery.id, status: delivery.status },
    data: { status: "CANCELLED", updatedAt: at },
  });
  if (updated.count !== 1) return false;
  await tx.deliveryStatusEvent.create({
    data: { deliveryId: delivery.id, fromStatus: delivery.status, toStatus: "CANCELLED", actorType: "SYSTEM", createdAt: at },
  });
  return true;
}
