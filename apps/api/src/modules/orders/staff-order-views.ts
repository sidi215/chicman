import {
  ORDER_ERROR_CODES,
  shopOrderLabel,
  type AdminOrderListQuery,
  type AdminShopOrderDetail,
  type AdminShopOrderListResponse,
  type AdminStatusEvent,
  type SellerOrderListQuery,
  type SellerShopOrderDetail,
  type SellerShopOrderListResponse,
  type ShopOrderReasonCode,
} from "@chicman/shared";

import type { Prisma } from "../../generated/prisma/client.js";
import { notFound } from "../../lib/http-error.js";
import { adminAttemptView, ATTEMPT_ORDER, sellerDeliveryRecordSelect, sellerDeliveryRecordView } from "../delivery/delivery-records.js";
import { adminPaymentEventView, sellerPaymentSelect, sellerPaymentView } from "../payments/payment-views.js";
import type { MediaUrl } from "../products/product-views.js";
import {
  cancellerView,
  deliverySnapshotSelect,
  deliverySnapshotView,
  isAnswerable,
  isCancellableAfterConfirmation,
  ITEM_ORDER,
  itemView,
  orderItemSelect,
  type Db,
} from "./order-views.js";

export const shopOrderNotFound = () => notFound(ORDER_ERROR_CODES.shopOrderNotFound);

const unitsOf = (items: readonly { quantity: number }[]): number => items.reduce((sum, item) => sum + item.quantity, 0);

// ---------------------------------------------------------------------------
// Seller (spec 11 section 10, D11): own shop orders only; staged details
// ---------------------------------------------------------------------------

/** The seller's own shop orders, newest first. Only the area of each delivery. */
export async function listSellerShopOrders(db: Db, shopId: string, query: SellerOrderListQuery): Promise<SellerShopOrderListResponse> {
  const where = { shopId, ...(query.status === undefined ? {} : { status: query.status }) } satisfies Prisma.ShopOrderWhereInput;
  const [total, rows] = await Promise.all([
    db.shopOrder.count({ where }),
    db.shopOrder.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true,
        createdAt: true,
        status: true,
        respondBy: true,
        total: true,
        city: true,
        district: true,
        order: { select: { reference: true } },
        delivery: { select: { status: true } },
        items: { select: { quantity: true } },
      },
    }),
  ]);
  return {
    shopOrders: rows.map((row) => {
      const deliveryStatus = row.delivery?.status ?? null;
      return {
        id: row.id,
        orderReference: row.order.reference,
        createdAt: row.createdAt.toISOString(),
        status: row.status,
        label: shopOrderLabel(row.status, deliveryStatus),
        deliveryStatus,
        respondBy: row.respondBy.toISOString(),
        itemsCount: unitsOf(row.items),
        total: row.total.toFixed(2),
        city: row.city,
        district: row.district,
      };
    }),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}

/**
 * The seller's detail. The full delivery snapshot (recipient, phone, landmark,
 * pin) only once the order was confirmed, which is exactly when a delivery
 * exists; before that, the city and district only. The administrator's
 * internal reason and note are never selected.
 */
export async function loadSellerShopOrder(db: Db, shopId: string, shopOrderId: string, mediaUrl: MediaUrl, now: Date = new Date()): Promise<SellerShopOrderDetail> {
  const row = await db.shopOrder.findFirst({
    where: { id: shopOrderId, shopId },
    select: {
      id: true,
      createdAt: true,
      status: true,
      respondBy: true,
      decidedAt: true,
      closedAt: true,
      cancelledBy: true,
      reasonCode: true,
      reasonText: true,
      productsSubtotal: true,
      deliveryFee: true,
      total: true,
      ...deliverySnapshotSelect,
      order: { select: { reference: true } },
      items: { orderBy: ITEM_ORDER, select: orderItemSelect },
      payment: { select: sellerPaymentSelect },
      shop: { select: { status: true } },
      delivery: { select: sellerDeliveryRecordSelect },
    },
  });
  if (row === null) throw shopOrderNotFound();
  if (row.payment === null) throw new Error("shop order without payment");
  const deliveryStatus = row.delivery?.status ?? null;
  // An administrator's cancellation keeps its reason internal: the seller sees "Chicman" only.
  const showsReason = row.cancelledBy !== "ADMIN";
  return {
    id: row.id,
    orderReference: row.order.reference,
    createdAt: row.createdAt.toISOString(),
    status: row.status,
    label: shopOrderLabel(row.status, deliveryStatus),
    deliveryStatus,
    respondBy: row.respondBy.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    decision: {
      cancelledBy: cancellerView(row.cancelledBy),
      reason: showsReason ? (row.reasonCode as ShopOrderReasonCode | null) : null,
      reasonText: showsReason ? row.reasonText : null,
    },
    productsSubtotal: row.productsSubtotal.toFixed(2),
    deliveryFee: row.deliveryFee.toFixed(2),
    total: row.total.toFixed(2),
    items: row.items.map((item) => itemView(item, mediaUrl)),
    delivery: row.delivery === null ? { stage: "LIMITED", city: row.city, district: row.district } : { stage: "FULL", ...deliverySnapshotView(row) },
    payment: sellerPaymentView(row.payment),
    deliveryRecord: row.delivery === null ? null : sellerDeliveryRecordView(row.delivery, row.shop.status),
    actions: {
      confirm: isAnswerable(row.status, row.respondBy, now),
      reject: isAnswerable(row.status, row.respondBy, now),
      cancel: isCancellableAfterConfirmation(row.status, deliveryStatus),
    },
  };
}

// ---------------------------------------------------------------------------
// Administrator: every shop order, everything, read-only, plus cancellation
// ---------------------------------------------------------------------------

/** UTC day bounds of `from`/`to` (inclusive). */
function placementRange(query: AdminOrderListQuery): Prisma.DateTimeFilter | undefined {
  if (query.from === undefined && query.to === undefined) return undefined;
  return {
    ...(query.from === undefined ? {} : { gte: new Date(`${query.from}T00:00:00.000Z`) }),
    ...(query.to === undefined ? {} : { lt: new Date(new Date(`${query.to}T00:00:00.000Z`).getTime() + 86_400_000) }),
  };
}

export async function listAdminShopOrders(db: Db, query: AdminOrderListQuery): Promise<AdminShopOrderListResponse> {
  const createdAt = placementRange(query);
  const where = {
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.shopId === undefined ? {} : { shopId: query.shopId }),
    ...(createdAt === undefined ? {} : { createdAt }),
  } satisfies Prisma.ShopOrderWhereInput;
  const [total, rows] = await Promise.all([
    db.shopOrder.count({ where }),
    db.shopOrder.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true,
        orderId: true,
        createdAt: true,
        status: true,
        respondBy: true,
        total: true,
        shopId: true,
        shopName: true,
        order: { select: { reference: true, userId: true } },
        delivery: { select: { status: true } },
      },
    }),
  ]);
  return {
    shopOrders: rows.map((row) => {
      const deliveryStatus = row.delivery?.status ?? null;
      return {
        id: row.id,
        orderId: row.orderId,
        orderReference: row.order.reference,
        createdAt: row.createdAt.toISOString(),
        status: row.status,
        label: shopOrderLabel(row.status, deliveryStatus),
        deliveryStatus,
        shop: { id: row.shopId, name: row.shopName },
        customerUserId: row.order.userId,
        total: row.total.toFixed(2),
        respondBy: row.respondBy.toISOString(),
      };
    }),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}

const eventView = (event: {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  actorType: AdminStatusEvent["actorType"];
  actorUserId: string | null;
  reasonCode: string | null;
  reasonText?: string | null;
  internalReason?: string | null;
  internalNote?: string | null;
  createdAt: Date;
}): AdminStatusEvent => ({
  id: event.id,
  fromStatus: event.fromStatus,
  toStatus: event.toStatus,
  actorType: event.actorType,
  actorUserId: event.actorUserId,
  reasonCode: event.reasonCode,
  reasonText: event.reasonText ?? null,
  internalReason: event.internalReason ?? null,
  internalNote: event.internalNote ?? null,
  createdAt: event.createdAt.toISOString(),
});

/** Everything about one shop order, including history, internal reasons, notes, and stock movements. */
export async function loadAdminShopOrder(db: Db, shopOrderId: string, adminUserId: string, mediaUrl: MediaUrl, now: Date = new Date()): Promise<AdminShopOrderDetail> {
  const row = await db.shopOrder.findUnique({
    where: { id: shopOrderId },
    include: {
      order: { select: { reference: true, userId: true } },
      shop: { select: { ownerUserId: true } },
      items: { orderBy: ITEM_ORDER },
      statusEvents: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      payment: { include: { events: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } } },
      delivery: { include: { events: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] }, attempts: { orderBy: ATTEMPT_ORDER } } },
    },
  });
  if (row === null) throw shopOrderNotFound();
  if (row.payment === null) throw new Error("shop order without payment");
  const movements = await db.stockMovement.findMany({
    where: { orderItem: { shopOrderId } },
    orderBy: [{ createdAt: "asc" }, { type: "asc" }, { id: "asc" }],
  });
  const deliveryStatus = row.delivery?.status ?? null;
  const cancellable = isAnswerable(row.status, row.respondBy, now) || isCancellableAfterConfirmation(row.status, deliveryStatus);
  return {
    id: row.id,
    orderId: row.orderId,
    orderReference: row.order.reference,
    customerUserId: row.order.userId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    status: row.status,
    label: shopOrderLabel(row.status, deliveryStatus),
    respondBy: row.respondBy.toISOString(),
    remindAt: row.remindAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    decision: {
      cancelledBy: row.cancelledBy,
      reasonCode: row.reasonCode,
      reasonText: row.reasonText,
      internalReason: row.internalReason,
      internalNote: row.internalNote,
    },
    shop: { id: row.shopId, name: row.shopName, contactPhone: row.shopContactPhone, whatsappPhone: row.shopWhatsappPhone },
    productsSubtotal: row.productsSubtotal.toFixed(2),
    deliveryFee: row.deliveryFee.toFixed(2),
    total: row.total.toFixed(2),
    delivery: deliverySnapshotView(row),
    items: row.items.map((item) => ({ ...itemView(item, mediaUrl), variantId: item.variantId })),
    payment: {
      method: row.payment.method,
      amountDue: row.payment.amountDue.toFixed(2),
      status: row.payment.status,
      collectedAmount: row.payment.collectedAmount?.toFixed(2) ?? null,
      collectedAt: row.payment.collectedAt?.toISOString() ?? null,
      events: row.payment.events.map(adminPaymentEventView),
    },
    deliveryRecord:
      row.delivery === null
        ? null
        : {
            status: row.delivery.status,
            createdAt: row.delivery.createdAt.toISOString(),
            autoCloseAt: row.delivery.autoCloseAt?.toISOString() ?? null,
            closedAt: row.delivery.closedAt?.toISOString() ?? null,
            attempts: row.delivery.attempts.map(adminAttemptView),
            events: row.delivery.events.map(eventView),
          },
    history: row.statusEvents.map(eventView),
    stockMovements: movements.map((movement) => ({
      id: movement.id,
      orderItemId: movement.orderItemId,
      productId: movement.productId,
      variantId: movement.variantId,
      quantity: movement.quantity,
      type: movement.type,
      applied: movement.applied,
      skipReason: movement.skipReason,
      createdAt: movement.createdAt.toISOString(),
    })),
    canCancel: cancellable && row.shop.ownerUserId !== adminUserId,
  };
}
