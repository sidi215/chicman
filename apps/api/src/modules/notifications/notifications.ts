import type { Prisma } from "../../generated/prisma/client.js";

/** What a notification may point at. Opening it goes through that resource's own route. */
export type NotificationResource = { type: "SHOP" | "SHOP_ORDER"; id: string };

export interface NotificationRecord {
  recipientUserId: string;
  type: string;
  /** An allowlisted payload, built field by field by the caller. Never a copy of a row. */
  payload: Prisma.InputJsonObject;
  /** The ID of the record that makes this event unique (spec 15, section 3). */
  sourceId: string;
  resource?: NotificationResource;
}

/** `<type>:<source record ID>:<recipient user ID>`. */
export function notificationEventKey(type: string, sourceId: string, recipientUserId: string): string {
  return `${type}:${sourceId}:${recipientUserId}`;
}

/**
 * Records one in-app notification inside the caller's transaction (spec 15), so
 * it exists exactly when the business change commits. The insert does nothing
 * when the event key already exists, so a repeated event never duplicates.
 *
 * In-app persistence only: no email, push, or SMS is sent, and `deliveredAt`
 * stays empty until an external channel exists.
 */
export async function recordNotification(tx: Prisma.TransactionClient, record: NotificationRecord): Promise<void> {
  await tx.notification.createMany({
    data: [
      {
        userId: record.recipientUserId,
        type: record.type,
        payload: record.payload,
        eventKey: notificationEventKey(record.type, record.sourceId, record.recipientUserId),
        resourceType: record.resource?.type ?? null,
        resourceId: record.resource?.id ?? null,
      },
    ],
    skipDuplicates: true,
  });
}
