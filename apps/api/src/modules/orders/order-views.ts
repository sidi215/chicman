import {
  ORDER_ERROR_CODES,
  shopOrderLabel,
  type CustomerOrder,
  type CustomerOrderItem,
  type CustomerOrderListQuery,
  type CustomerOrderListResponse,
  type CustomerShopOrderDecision,
  type DeliveryStatus,
  type OrderActorType,
  type OrderDeliverySnapshot,
  type SellerCancellationReason,
  type ShopOrderCanceller,
  type ShopOrderStatus,
  type SystemCancellationReason,
} from "@chicman/shared";

import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { notFound } from "../../lib/http-error.js";
import { CANCELLABLE_DELIVERY_STATUSES } from "../delivery/delivery.js";
import { customerDeliveryProgress, customerDeliverySelect } from "../delivery/delivery-records.js";
import { customerPaymentSelect, customerPaymentView } from "../payments/payment-views.js";
import type { MediaUrl } from "../products/product-views.js";

export type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Response views of orders (spec 11, section 10). Every response is built
 * field by field from these selections, never by serializing rows: columns a
 * viewer may not see are not selected at all.
 */

/** The item columns every viewer may see. */
export const orderItemSelect = {
  id: true,
  productId: true,
  productName: true,
  size: true,
  color: true,
  imageObjectKey: true,
  unitPrice: true,
  quantity: true,
  lineTotal: true,
} satisfies Prisma.OrderItemSelect;

export type OrderItemRow = Prisma.OrderItemGetPayload<{ select: typeof orderItemSelect }>;

/** The delivery snapshot columns (D11). Only selected for viewers allowed to see them. */
export const deliverySnapshotSelect = {
  recipientName: true,
  deliveryPhone: true,
  addressLabel: true,
  city: true,
  district: true,
  landmark: true,
  latitude: true,
  longitude: true,
  locationSource: true,
  accuracyMeters: true,
} satisfies Prisma.ShopOrderSelect;

export type DeliverySnapshotRow = Prisma.ShopOrderGetPayload<{ select: typeof deliverySnapshotSelect }>;

/** Items in display order: by product name (the tables keep no position). */
export const ITEM_ORDER = [{ productName: "asc" }, { id: "asc" }] satisfies Prisma.OrderItemOrderByWithRelationInput[];

/** Images are the snapshotted keys (S2-7); a missing key shows the placeholder. */
export function itemView(item: OrderItemRow, mediaUrl: MediaUrl): CustomerOrderItem {
  return {
    id: item.id,
    productId: item.productId,
    productName: item.productName,
    size: item.size,
    color: item.color,
    imageUrl: item.imageObjectKey === null ? null : mediaUrl(item.imageObjectKey),
    unitPrice: item.unitPrice.toFixed(2),
    quantity: item.quantity,
    lineTotal: item.lineTotal.toFixed(2),
  };
}

export function deliverySnapshotView(row: DeliverySnapshotRow): OrderDeliverySnapshot {
  return {
    recipientName: row.recipientName,
    deliveryPhone: row.deliveryPhone,
    label: row.addressLabel,
    city: row.city,
    district: row.district,
    landmark: row.landmark,
    latitude: row.latitude.toNumber(),
    longitude: row.longitude.toNumber(),
    locationSource: row.locationSource,
    accuracyMeters: row.accuracyMeters,
  };
}

/** An administrator is only ever "Chicman" outside the administration (D6). */
export function cancellerView(actor: OrderActorType | null): ShopOrderCanceller | null {
  if (actor === null) return null;
  return actor === "ADMIN" ? "CHICMAN" : actor;
}

/** Before the deadline, a pending shop order can still be answered or cancelled by its customer (D7). */
export const isAnswerable = (status: ShopOrderStatus, respondBy: Date, now: Date): boolean => status === "PENDING" && now < respondBy;

/** A confirmed shop order can be cancelled until its delivery leaves (D6). */
export const isCancellableAfterConfirmation = (status: ShopOrderStatus, deliveryStatus: DeliveryStatus | null): boolean =>
  status === "CONFIRMED" && deliveryStatus !== null && CANCELLABLE_DELIVERY_STATUSES.includes(deliveryStatus);

/**
 * What the customer sees of a decision (section 6): the seller's or the
 * system's reason, translated by the client. The customer's own reason and
 * text, and anything an administrator wrote, are not returned.
 */
function customerDecision(row: { status: ShopOrderStatus; cancelledBy: OrderActorType | null; reasonCode: string | null }): CustomerShopOrderDecision {
  const cancelledBy = cancellerView(row.cancelledBy);
  const showsReason = row.status === "REJECTED" || (row.status === "CANCELLED" && (row.cancelledBy === "SELLER" || row.cancelledBy === "SYSTEM"));
  return { cancelledBy, reason: showsReason ? (row.reasonCode as SellerCancellationReason | SystemCancellationReason | null) : null };
}

/**
 * The columns the customer may see (spec 11 section 10, spec 13 section 10).
 * Internal reasons and notes, the customer's own reason text, actors,
 * history, stock movements, payment events, and delivery actors and deadlines
 * are never selected, so they cannot reach the response.
 */
const customerOrderSelect = {
  id: true,
  reference: true,
  createdAt: true,
  productsSubtotal: true,
  deliveryFeeTotal: true,
  total: true,
  shopOrders: {
    orderBy: [{ shopName: "asc" }, { id: "asc" }],
    select: {
      id: true,
      shopId: true,
      shopName: true,
      shopContactPhone: true,
      shopWhatsappPhone: true,
      status: true,
      respondBy: true,
      closedAt: true,
      cancelledBy: true,
      reasonCode: true,
      productsSubtotal: true,
      deliveryFee: true,
      total: true,
      ...deliverySnapshotSelect,
      items: { orderBy: ITEM_ORDER, select: orderItemSelect },
      payment: { select: customerPaymentSelect },
      delivery: { select: { status: true, ...customerDeliverySelect } },
    },
  },
} satisfies Prisma.OrderSelect;

/**
 * The customer's own order, built field by field. Another customer's order is
 * `404`, never disclosed. Images are the snapshotted keys (S2-7); a missing
 * key shows the placeholder.
 */
export async function loadCustomerOrder(db: Db, customerUserId: string, orderId: string, mediaUrl: MediaUrl, now: Date = new Date()): Promise<CustomerOrder> {
  const order = await db.order.findFirst({ where: { id: orderId, userId: customerUserId }, select: customerOrderSelect });
  if (order === null) throw notFound(ORDER_ERROR_CODES.notFound);
  return {
    id: order.id,
    reference: order.reference,
    createdAt: order.createdAt.toISOString(),
    productsSubtotal: order.productsSubtotal.toFixed(2),
    deliveryFeeTotal: order.deliveryFeeTotal.toFixed(2),
    total: order.total.toFixed(2),
    paymentMethod: "CASH_ON_DELIVERY",
    shopOrders: order.shopOrders.map((shopOrder) => {
      const { payment } = shopOrder;
      // Created in the same transaction as the shop order (spec 13), so always present.
      if (payment === null) throw new Error("shop order without payment");
      const deliveryStatus = shopOrder.delivery?.status ?? null;
      return {
        id: shopOrder.id,
        status: shopOrder.status,
        label: shopOrderLabel(shopOrder.status, deliveryStatus),
        deliveryStatus,
        deliveryProgress: shopOrder.delivery === null ? null : customerDeliveryProgress(shopOrder.delivery),
        respondBy: shopOrder.respondBy.toISOString(),
        closedAt: shopOrder.closedAt?.toISOString() ?? null,
        decision: customerDecision(shopOrder),
        canCancel: isAnswerable(shopOrder.status, shopOrder.respondBy, now),
        shop: {
          id: shopOrder.shopId,
          name: shopOrder.shopName,
          contactPhone: shopOrder.shopContactPhone,
          whatsappPhone: shopOrder.shopWhatsappPhone,
        },
        productsSubtotal: shopOrder.productsSubtotal.toFixed(2),
        deliveryFee: shopOrder.deliveryFee.toFixed(2),
        total: shopOrder.total.toFixed(2),
        delivery: deliverySnapshotView(shopOrder),
        items: shopOrder.items.map((item) => itemView(item, mediaUrl)),
        payment: customerPaymentView(payment),
      };
    }),
  };
}

/** The customer's own orders, newest first. */
export async function listCustomerOrders(db: Db, customerUserId: string, query: CustomerOrderListQuery): Promise<CustomerOrderListResponse> {
  const where = { userId: customerUserId } satisfies Prisma.OrderWhereInput;
  const [total, orders] = await Promise.all([
    db.order.count({ where }),
    db.order.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true,
        reference: true,
        createdAt: true,
        total: true,
        shopOrders: {
          orderBy: [{ shopName: "asc" }, { id: "asc" }],
          select: { id: true, shopName: true, status: true, delivery: { select: { status: true } }, items: { select: { quantity: true } } },
        },
      },
    }),
  ]);
  return {
    orders: orders.map((order) => ({
      id: order.id,
      reference: order.reference,
      createdAt: order.createdAt.toISOString(),
      total: order.total.toFixed(2),
      itemsCount: order.shopOrders.reduce((count, shopOrder) => count + shopOrder.items.reduce((sum, item) => sum + item.quantity, 0), 0),
      shopOrders: order.shopOrders.map((shopOrder) => ({
        id: shopOrder.id,
        shopName: shopOrder.shopName,
        status: shopOrder.status,
        label: shopOrderLabel(shopOrder.status, shopOrder.delivery?.status ?? null),
      })),
    })),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}
