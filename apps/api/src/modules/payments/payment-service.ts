import { ORDER_ERROR_CODES, SHOP_ERROR_CODES, type AdminPaymentEvent, type SellerPaymentSummary, type SellerPaymentSummaryQuery } from "@chicman/shared";

import { Prisma } from "../../generated/prisma/client.js";
import { HttpError, notFound } from "../../lib/http-error.js";
import type { PrismaClient } from "../../lib/prisma.js";
import { adminPaymentEventView } from "./payment-views.js";

const DAY_MS = 86_400_000;

const ZERO = new Prisma.Decimal(0);

/**
 * The payment routes' side of spec 13: administrator correction notes
 * (section 7) and the seller's collection summary (section 9). Collection
 * and closing run inside the order and delivery transactions (`payments.ts`).
 */
export class PaymentService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Appends an `ADMIN_NOTE` event to the shop order's payment. Never changes
   * a status or an amount, and works on a final payment too. Refused on a
   * shop the administrator owns (`403`). A missing shop order → `404`.
   */
  async addAdminNote(adminUserId: string, shopOrderId: string, reason: string, at: Date = new Date()): Promise<AdminPaymentEvent> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.shopOrder.findUnique({
        where: { id: shopOrderId },
        select: { shop: { select: { ownerUserId: true } }, payment: { select: { id: true } } },
      });
      if (row === null || row.payment === null) throw notFound(ORDER_ERROR_CODES.shopOrderNotFound);
      if (row.shop.ownerUserId === adminUserId) throw new HttpError(403, SHOP_ERROR_CODES.selfAdministrationForbidden);
      const event = await tx.paymentEvent.create({
        data: { paymentId: row.payment.id, type: "ADMIN_NOTE", actorType: "ADMIN", actorUserId: adminUserId, reason, createdAt: at },
      });
      return adminPaymentEventView(event);
    });
  }

  /**
   * The payments of the seller's shop orders placed in the period (UTC days,
   * both included), counted and summed by status straight from the payment
   * records.
   */
  async sellerSummary(shopId: string, query: SellerPaymentSummaryQuery): Promise<SellerPaymentSummary> {
    const gte = new Date(`${query.from}T00:00:00.000Z`);
    const lt = new Date(Date.parse(`${query.to}T00:00:00.000Z`) + DAY_MS);
    const groups = await this.prisma.payment.groupBy({
      by: ["status"],
      where: { shopOrder: { shopId, createdAt: { gte, lt } } },
      _count: { _all: true },
      _sum: { amountDue: true, collectedAmount: true },
    });
    const of = (status: (typeof groups)[number]["status"]) => groups.find((group) => group.status === status);
    const collected = of("COLLECTED");
    const pending = of("PENDING");
    return {
      from: query.from,
      to: query.to,
      collected: { count: collected?._count._all ?? 0, total: (collected?._sum.collectedAmount ?? ZERO).toFixed(2) },
      pending: { count: pending?._count._all ?? 0, total: (pending?._sum.amountDue ?? ZERO).toFixed(2) },
      failed: { count: of("FAILED")?._count._all ?? 0 },
      cancelled: { count: of("CANCELLED")?._count._all ?? 0 },
    };
  }
}
