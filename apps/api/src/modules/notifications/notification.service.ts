import {
  CUSTOMER_ONLY_NOTIFICATION_TYPES,
  NOTIFICATION_ERROR_CODES,
  SHARED_ORDER_NOTIFICATION_TYPES,
  type NotificationAudience,
  type NotificationItem,
  type NotificationList,
  type NotificationListQuery,
  type NotificationScopeQuery,
  type NotificationUnreadCount,
} from "@chicman/shared";

import { Prisma } from "../../generated/prisma/client.js";
import { badRequest, notFound } from "../../lib/http-error.js";
import type { PrismaClient } from "../../lib/prisma.js";

interface NotificationRow {
  id: string;
  type: string;
  payload: unknown;
  resourceType: "SHOP" | "SHOP_ORDER" | null;
  resourceId: string | null;
  createdAt: Date;
  readAt: Date | null;
  /** The parent order of a `SHOP_ORDER` resource, when this user placed it. */
  customerOrderId: string | null;
}

const CUSTOMER_ONLY: ReadonlySet<string> = new Set(CUSTOMER_ONLY_NOTIFICATION_TYPES);
const SHARED: ReadonlySet<string> = new Set(SHARED_ORDER_NOTIFICATION_TYPES);
const CUSTOMER_CAPABLE = [...CUSTOMER_ONLY_NOTIFICATION_TYPES, ...SHARED_ORDER_NOTIFICATION_TYPES];

/**
 * The order this user placed, for a notification about one of its shop
 * orders. Checkout refuses an order from one's own shop (spec 10, `OWN_SHOP`),
 * so a shop order's customer and seller are never the same user.
 */
const CUSTOMER_ORDER_ID = Prisma.sql`(
  SELECT so."orderId" FROM "ShopOrder" so JOIN "Order" o ON o."id" = so."orderId"
  WHERE n."resourceType" = 'SHOP_ORDER' AND so."id" = n."resourceId" AND o."userId" = n."userId"
)`;

/** Customer order notifications only (`audience=CUSTOMER`, for the mobile app). */
const CUSTOMER_ORDER_NOTIFICATION = Prisma.sql`n."type" IN (${Prisma.join(CUSTOMER_CAPABLE)}) AND ${CUSTOMER_ORDER_ID} IS NOT NULL`;

/**
 * The cursor is the last item's `(createdAt, id)`, opaque to clients. It is
 * read back strictly: anything else is a `400`.
 */
function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`, "utf8").toString("base64url");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const [at = "", id = "", ...rest] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  const createdAt = new Date(at);
  if (rest.length > 0 || !ISO.test(at) || Number.isNaN(createdAt.getTime()) || !UUID.test(id)) throw badRequest();
  return { createdAt, id };
}

function audienceOf(row: NotificationRow): NotificationAudience {
  if (CUSTOMER_ONLY.has(row.type)) return "CUSTOMER";
  if (SHARED.has(row.type)) return row.customerOrderId === null ? "SELLER" : "CUSTOMER";
  return "SELLER";
}

function toItem(row: NotificationRow): NotificationItem {
  const audience = audienceOf(row);
  let resource: NotificationItem["resource"] = null;
  if (row.resourceType === "SHOP" && row.resourceId !== null) resource = { type: "SHOP", id: row.resourceId };
  if (row.resourceType === "SHOP_ORDER" && row.resourceId !== null) {
    resource = { type: "SHOP_ORDER", id: row.resourceId, orderId: audience === "CUSTOMER" ? row.customerOrderId : null };
  }
  // The payload was allowlisted when it was recorded (spec 15, section 5); it is returned as stored.
  return {
    id: row.id,
    type: row.type,
    payload: row.payload,
    audience,
    resource,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
  } as NotificationItem;
}

const scopeOf = (query: NotificationScopeQuery) => (query.audience === "CUSTOMER" ? Prisma.sql`AND ${CUSTOMER_ORDER_NOTIFICATION}` : Prisma.empty);

/**
 * Reading the authenticated user's notifications (spec 15). The recipient is
 * always the user from the verified token: every query is bound to
 * `n."userId"`, so another user's notification is never read, counted, or
 * changed, and asking for it is a `404`. `deliveredAt` is never written here:
 * in-app display is not delivery.
 */
export class NotificationService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(userId: string, query: NotificationListQuery): Promise<NotificationList> {
    const after = query.cursor === undefined ? null : decodeCursor(query.cursor);
    const page = after === null ? Prisma.empty : Prisma.sql`AND (n."createdAt", n."id") < (${after.createdAt}, ${after.id}::uuid)`;
    const rows = await this.prisma.$queryRaw<NotificationRow[]>`
      SELECT n."id", n."type", n."payload", n."resourceType", n."resourceId", n."createdAt", n."readAt",
             ${CUSTOMER_ORDER_ID} AS "customerOrderId"
      FROM "Notification" n
      WHERE n."userId" = ${userId}::uuid ${scopeOf(query)} ${page}
      ORDER BY n."createdAt" DESC, n."id" DESC
      LIMIT ${query.limit + 1}`;
    const items = rows.slice(0, query.limit);
    const last = items.at(-1);
    return { items: items.map(toItem), nextCursor: rows.length > query.limit && last !== undefined ? encodeCursor(last) : null };
  }

  async unreadCount(userId: string, query: NotificationScopeQuery): Promise<NotificationUnreadCount> {
    const [row] = await this.prisma.$queryRaw<{ unread: number }[]>`
      SELECT count(*)::int AS "unread" FROM "Notification" n
      WHERE n."userId" = ${userId}::uuid AND n."readAt" IS NULL ${scopeOf(query)}`;
    return { unread: row?.unread ?? 0 };
  }

  /** Idempotent: an already read notification keeps its first `readAt`. */
  async markRead(userId: string, notificationId: string): Promise<void> {
    const updated = await this.prisma.notification.updateMany({ where: { id: notificationId, userId, readAt: null }, data: { readAt: new Date() } });
    if (updated.count === 1) return;
    const own = await this.prisma.notification.findFirst({ where: { id: notificationId, userId }, select: { id: true } });
    if (own === null) throw notFound(NOTIFICATION_ERROR_CODES.notFound);
  }

  /** Idempotent: marks every unread notification in scope, and nothing else. */
  async markAllRead(userId: string, query: NotificationScopeQuery): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE "Notification" AS n SET "readAt" = ${new Date()}
      WHERE n."userId" = ${userId}::uuid AND n."readAt" IS NULL ${scopeOf(query)}`;
  }
}
