import type { SellerDelivery, SellerInProgressDeliveriesResponse } from "@chicman/shared";
import { shopOrderLabel } from "@chicman/shared";

import type { Prisma } from "../../generated/prisma/client.js";
import { deliverySnapshotSelect, deliverySnapshotView, ITEM_ORDER, itemView, orderItemSelect, type Db } from "../orders/order-views.js";
import { shopOrderNotFound } from "../orders/staff-order-views.js";
import { sellerPaymentSelect, sellerPaymentView } from "../payments/payment-views.js";
import type { MediaUrl } from "../products/product-views.js";
import { sellerDeliveryRecordSelect, sellerDeliveryRecordView } from "./delivery-records.js";

// ---------------------------------------------------------------------------
// Seller delivery views: a delivery action's result and the in-progress list
// ---------------------------------------------------------------------------

/** A confirmed shop order with its delivery: the full snapshot (D11), items, amount due. */
const sellerDeliverySelect = {
  id: true,
  status: true,
  productsSubtotal: true,
  deliveryFee: true,
  total: true,
  ...deliverySnapshotSelect,
  order: { select: { reference: true } },
  shop: { select: { status: true } },
  items: { orderBy: ITEM_ORDER, select: orderItemSelect },
  payment: { select: sellerPaymentSelect },
  delivery: { select: sellerDeliveryRecordSelect },
} satisfies Prisma.ShopOrderSelect;

type SellerDeliveryRow = Prisma.ShopOrderGetPayload<{ select: typeof sellerDeliverySelect }>;

function sellerDeliveryView(row: SellerDeliveryRow, mediaUrl: MediaUrl): SellerDelivery | null {
  if (row.delivery === null) return null;
  if (row.payment === null) throw new Error("shop order without payment");
  return {
    shopOrderId: row.id,
    orderReference: row.order.reference,
    shopOrderStatus: row.status,
    label: shopOrderLabel(row.status, row.delivery.status),
    productsSubtotal: row.productsSubtotal.toFixed(2),
    deliveryFee: row.deliveryFee.toFixed(2),
    total: row.total.toFixed(2),
    payment: sellerPaymentView(row.payment),
    delivery: deliverySnapshotView(row),
    items: row.items.map((item) => itemView(item, mediaUrl)),
    record: sellerDeliveryRecordView(row.delivery, row.shop.status),
  };
}

/** The delivery of one of the seller's own shop orders (another shop's → `404`). */
export async function loadSellerDelivery(db: Db, shopId: string, shopOrderId: string, mediaUrl: MediaUrl): Promise<SellerDelivery> {
  const row = await db.shopOrder.findFirst({ where: { id: shopOrderId, shopId }, select: sellerDeliverySelect });
  const view = row === null ? null : sellerDeliveryView(row, mediaUrl);
  if (view === null) throw shopOrderNotFound();
  return view;
}

/**
 * The deliveries the seller must finish: out for delivery, or failed and not
 * closed (D8). The only orders the owner of a suspended shop sees. Oldest
 * order first. Naturally bounded: only deliveries under way.
 */
export async function listInProgressDeliveries(db: Db, shopId: string, mediaUrl: MediaUrl): Promise<SellerInProgressDeliveriesResponse> {
  const rows = await db.shopOrder.findMany({
    where: {
      shopId,
      delivery: { OR: [{ status: "OUT_FOR_DELIVERY" }, { status: "FAILED", closedAt: null }] },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: sellerDeliverySelect,
  });
  return { deliveries: rows.flatMap((row) => sellerDeliveryView(row, mediaUrl) ?? []) };
}
