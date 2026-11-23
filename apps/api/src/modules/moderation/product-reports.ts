import { PRODUCT_ERROR_CODES, type ProductReportReason, type ProductReportReceipt } from "@chicman/shared";

import type { Prisma } from "../../generated/prisma/client.js";
import { notFound } from "../../lib/http-error.js";
import type { PrismaClient } from "../../lib/prisma.js";
import { PUBLIC_PRODUCT_WHERE } from "../products/product-visibility.js";
import { appendModerationEvent, lockShopForShare } from "./moderation-records.js";

export interface ProductReportInput {
  productId: string;
  reasonCode: ProductReportReason;
  details?: string | undefined;
}

export interface ProductReportResult {
  created: boolean;
  receipt: ProductReportReceipt;
}

/** Test-only fault injection. */
export interface ProductReportFaults {
  /** After the shop and product share locks, before the case is opened. */
  afterLocks?: () => void | Promise<void>;
}

const productNotFound = () => notFound(PRODUCT_ERROR_CODES.notFound);

function toReceipt(report: { id: string; productId: string; reasonCode: string; createdAt: Date }): ProductReportReceipt {
  return { reportId: report.id, productId: report.productId, reasonCode: report.reasonCode as ProductReportReason, createdAt: report.createdAt.toISOString() };
}

/**
 * Buyer reports (spec 19, section 4). Only a currently public product can be
 * reported; anything else is the catalog's `404`. A report attaches to the
 * product's non-closed case or opens an `OPEN` one; it never changes the
 * product's visibility (PD-7). One report per buyer and case: a repeat returns
 * the existing report and writes nothing.
 *
 * Locks: shop `FOR SHARE` → product `FOR SHARE` (an administrator's action
 * waits for, or is waited on by, the report), then the case. Two reports
 * racing to open a case are settled by the partial unique index.
 */
export class ProductReportService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly faults: ProductReportFaults = {},
  ) {}

  async report(reporterUserId: string, input: ProductReportInput): Promise<ProductReportResult> {
    return this.prisma.$transaction(async (tx) => {
      const owner = await tx.product.findUnique({ where: { id: input.productId }, select: { shopId: true } });
      if (owner === null) throw productNotFound();
      await lockShopForShare(tx, owner.shopId);
      await tx.$queryRaw`SELECT 1 FROM "Product" WHERE "id" = ${input.productId}::uuid FOR SHARE`;
      await this.faults.afterLocks?.();
      // Re-checked under the locks with the single visibility rule.
      const visible = await tx.product.findFirst({ where: { AND: [PUBLIC_PRODUCT_WHERE, { id: input.productId }] }, select: { id: true } });
      if (visible === null) throw productNotFound();

      const caseId = await this.openCase(tx, input.productId, owner.shopId);
      const existing = await tx.productReport.findUnique({ where: { caseId_reporterUserId: { caseId, reporterUserId } } });
      if (existing !== null) return { created: false, receipt: toReceipt(existing) };

      const report = await tx.productReport.create({
        data: {
          caseId,
          productId: input.productId,
          reporterUserId,
          reasonCode: input.reasonCode,
          details: input.details ?? null,
        },
      });
      await tx.productModerationCase.update({ where: { id: caseId }, data: { reportCount: { increment: 1 } } });
      await appendModerationEvent(tx, {
        productId: input.productId,
        caseId,
        action: "REPORTED",
        fromStatus: "CLEAR",
        toStatus: "CLEAR",
        actorType: "BUYER",
        actorUserId: reporterUserId,
      });
      return { created: true, receipt: toReceipt(report) };
    });
  }

  /**
   * The product's non-closed case, locked, opening an `OPEN` one if there is
   * none. A concurrent opener's row makes this insert do nothing.
   */
  private async openCase(tx: Prisma.TransactionClient, productId: string, shopId: string): Promise<string> {
    await tx.$executeRaw`
      INSERT INTO "ProductModerationCase" ("id", "productId", "shopId", "status", "source", "openedAt", "reportCount")
      VALUES (gen_random_uuid(), ${productId}::uuid, ${shopId}::uuid, 'OPEN', 'REPORT', now(), 0)
      ON CONFLICT ("productId") WHERE "status" <> 'CLOSED' DO NOTHING`;
    const rows = await tx.$queryRaw<{ id: string; status: string }[]>`
      SELECT "id", "status"::text AS "status" FROM "ProductModerationCase"
      WHERE "productId" = ${productId}::uuid AND "status" <> 'CLOSED' FOR UPDATE`;
    const open = rows[0];
    // A public product's non-closed case is always `OPEN` (`ACTIVE` means hidden).
    if (open === undefined || open.status !== "OPEN") throw productNotFound();
    return open.id;
  }
}
