import { randomUUID } from "node:crypto";

import type { AddressLocationSource } from "@chicman/shared";

import type { Prisma } from "../../generated/prisma/client.js";
import { takeOrderStock } from "../inventory/order-stock.js";
import { lineTotal, orderAmounts, shopOrderAmounts } from "./order-amounts.js";
import { newOrderReference } from "./order-reference.js";

/** The delivery details copied onto every shop order (D11). Never a reference to the saved address. */
export interface DeliverySnapshot {
  recipientName: string;
  deliveryPhone: string;
  label: string | null;
  city: string;
  district: string;
  landmark: string;
  latitude: Prisma.Decimal;
  longitude: Prisma.Decimal;
  locationSource: AddressLocationSource;
  accuracyMeters: number | null;
}

/** An item's values, read from the locked product rows at placement, never from the cart. */
export interface OrderItemCreation {
  productId: string;
  variantId: string | null;
  productName: string;
  size: string | null;
  color: string | null;
  /** The product's first active image at placement (S2-7). */
  imageObjectKey: string | null;
  unitPrice: Prisma.Decimal;
  quantity: number;
}

export interface ShopOrderCreation {
  shopId: string;
  shopName: string;
  contactPhone: string;
  whatsappPhone: string | null;
  /** The shop's fee at placement (D2): copied, never read again. */
  deliveryFee: Prisma.Decimal;
  items: readonly OrderItemCreation[];
}

export interface OrderCreation {
  customerUserId: string;
  idempotencyKey: string;
  placedAt: Date;
  /** `ORDER_RESPONSE_TIMEOUT_HOURS`, read at placement so later changes never move deadlines (D7). */
  responseTimeoutHours: number;
  delivery: DeliverySnapshot;
  shops: readonly ShopOrderCreation[];
}

export interface CreatedShopOrder {
  id: string;
  shopId: string;
  total: Prisma.Decimal;
  /** Units ordered from this shop. */
  itemsCount: number;
  respondBy: Date;
}

export interface CreatedOrder {
  id: string;
  reference: string;
  shopOrders: CreatedShopOrder[];
}

const HOUR_MS = 3_600_000;

/**
 * Creates an order, its shop orders and items, takes their stock, and writes
 * each shop order's initial history (spec 11). Called only by checkout's
 * placement transaction (spec 10), which has already validated the lines and
 * holds the cart, shop, and product locks. Every shop order starts `PENDING`
 * with its response deadline and reminder time.
 *
 * Throws `OrderStockUnavailableError` if any stock cannot be taken; nothing
 * then survives the caller's rollback.
 */
export async function createOrder(tx: Prisma.TransactionClient, input: OrderCreation): Promise<CreatedOrder> {
  const respondBy = new Date(input.placedAt.getTime() + input.responseTimeoutHours * HOUR_MS);
  const remindAt = new Date(input.placedAt.getTime() + (input.responseTimeoutHours * HOUR_MS) / 2);
  const { delivery } = input;

  const shops = input.shops.map((shop) => ({
    ...shop,
    id: randomUUID(),
    amounts: shopOrderAmounts(shop.items, shop.deliveryFee),
    items: shop.items.map((item) => ({ ...item, id: randomUUID() })),
  }));
  const totals = orderAmounts(shops.map(({ amounts }) => amounts));
  const order = { id: randomUUID(), reference: newOrderReference() };

  await tx.order.create({
    data: {
      id: order.id,
      reference: order.reference,
      userId: input.customerUserId,
      idempotencyKey: input.idempotencyKey,
      productsSubtotal: totals.productsSubtotal,
      deliveryFeeTotal: totals.deliveryFeeTotal,
      total: totals.total,
      createdAt: input.placedAt,
    },
  });
  await tx.shopOrder.createMany({
    data: shops.map((shop) => ({
      id: shop.id,
      orderId: order.id,
      shopId: shop.shopId,
      shopName: shop.shopName,
      shopContactPhone: shop.contactPhone,
      shopWhatsappPhone: shop.whatsappPhone,
      status: "PENDING" as const,
      respondBy,
      remindAt,
      productsSubtotal: shop.amounts.productsSubtotal,
      deliveryFee: shop.amounts.deliveryFee,
      total: shop.amounts.total,
      recipientName: delivery.recipientName,
      deliveryPhone: delivery.deliveryPhone,
      addressLabel: delivery.label,
      city: delivery.city,
      district: delivery.district,
      landmark: delivery.landmark,
      latitude: delivery.latitude,
      longitude: delivery.longitude,
      locationSource: delivery.locationSource,
      accuracyMeters: delivery.accuracyMeters,
      createdAt: input.placedAt,
    })),
  });
  const items = shops.flatMap((shop) => shop.items.map((item) => ({ ...item, shopOrderId: shop.id })));
  await tx.orderItem.createMany({
    data: items.map((item) => ({
      id: item.id,
      shopOrderId: item.shopOrderId,
      productId: item.productId,
      variantId: item.variantId,
      productName: item.productName,
      size: item.size,
      color: item.color,
      imageObjectKey: item.imageObjectKey,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      lineTotal: lineTotal(item),
    })),
  });
  await takeOrderStock(
    tx,
    items.map((item) => ({ orderItemId: item.id, productId: item.productId, variantId: item.variantId, quantity: item.quantity })),
  );
  await tx.shopOrderStatusEvent.createMany({
    data: shops.map((shop) => ({
      shopOrderId: shop.id,
      fromStatus: null,
      toStatus: "PENDING" as const,
      actorType: "CUSTOMER" as const,
      actorUserId: input.customerUserId,
      createdAt: input.placedAt,
    })),
  });

  return {
    id: order.id,
    reference: order.reference,
    shopOrders: shops.map((shop) => ({
      id: shop.id,
      shopId: shop.shopId,
      total: shop.amounts.total,
      itemsCount: shop.items.reduce((count, item) => count + item.quantity, 0),
      respondBy,
    })),
  };
}
