import { ORDER_ERROR_CODES, shopOrderLabel, type CustomerOrder } from "@chicman/shared";

import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { notFound } from "../../lib/http-error.js";
import type { MediaUrl } from "../products/product-views.js";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * The columns the customer may see (spec 11 section 10, spec 13 section 10).
 * Internal reasons and notes, actors, history, stock movements, and payment
 * events are never selected, so they cannot reach the response.
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
      productsSubtotal: true,
      deliveryFee: true,
      total: true,
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
      items: {
        orderBy: [{ productName: "asc" }, { id: "asc" }],
        select: {
          id: true,
          productId: true,
          productName: true,
          size: true,
          color: true,
          imageObjectKey: true,
          unitPrice: true,
          quantity: true,
          lineTotal: true,
        },
      },
      payment: { select: { method: true, amountDue: true, status: true } },
    },
  },
} satisfies Prisma.OrderSelect;

/**
 * The customer's own order, built field by field. Another customer's order is
 * `404`, never disclosed. Images are the snapshotted keys (S2-7); a missing
 * key shows the placeholder.
 */
export async function loadCustomerOrder(db: Db, customerUserId: string, orderId: string, mediaUrl: MediaUrl): Promise<CustomerOrder> {
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
      return {
        id: shopOrder.id,
        status: shopOrder.status,
        label: shopOrderLabel(shopOrder.status),
        respondBy: shopOrder.respondBy.toISOString(),
        shop: {
          id: shopOrder.shopId,
          name: shopOrder.shopName,
          contactPhone: shopOrder.shopContactPhone,
          whatsappPhone: shopOrder.shopWhatsappPhone,
        },
        productsSubtotal: shopOrder.productsSubtotal.toFixed(2),
        deliveryFee: shopOrder.deliveryFee.toFixed(2),
        total: shopOrder.total.toFixed(2),
        delivery: {
          recipientName: shopOrder.recipientName,
          deliveryPhone: shopOrder.deliveryPhone,
          label: shopOrder.addressLabel,
          city: shopOrder.city,
          district: shopOrder.district,
          landmark: shopOrder.landmark,
          latitude: shopOrder.latitude.toNumber(),
          longitude: shopOrder.longitude.toNumber(),
          locationSource: shopOrder.locationSource,
          accuracyMeters: shopOrder.accuracyMeters,
        },
        items: shopOrder.items.map((item) => ({
          id: item.id,
          productId: item.productId,
          productName: item.productName,
          size: item.size,
          color: item.color,
          imageUrl: item.imageObjectKey === null ? null : mediaUrl(item.imageObjectKey),
          unitPrice: item.unitPrice.toFixed(2),
          quantity: item.quantity,
          lineTotal: item.lineTotal.toFixed(2),
        })),
        payment: { method: payment.method, amountDue: payment.amountDue.toFixed(2), status: payment.status },
      };
    }),
  };
}
