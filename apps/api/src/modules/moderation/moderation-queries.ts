import {
  PRODUCT_ERROR_CODES,
  SELLER_VISIBLE_MODERATION_ACTIONS,
  type AdminModerationCaseDetail,
  type AdminModerationCaseListQuery,
  type AdminModerationCaseListResponse,
  type AdminModerationCaseSummary,
  type AdminModerationEvent,
  type AdminProductDetail,
  type AdminProductListQuery,
  type AdminProductListResponse,
  type AdminProductReport,
  type ModerationActorType,
  type ModerationCaseCounts,
  type ModerationCaseOutcome,
  type ModerationCaseSource,
  type ModerationCaseStatus,
  type ModerationContentSnapshot,
  type ProductCategory,
  type ProductImageContentType,
  type ProductModerationAction,
  type ProductModerationReason,
  type ProductModerationStatus,
  type ProductReportReason,
  type ProductStatus,
  type SellerModerationHistoryEntry,
  type SellerProductModerationResponse,
  type ShopStatus,
} from "@chicman/shared";

import { Prisma } from "../../generated/prisma/client.js";
import { notFound } from "../../lib/http-error.js";
import type { PrismaClient } from "../../lib/prisma.js";
import { isStockAvailable, productAvailability } from "../inventory/availability.js";
import { sellerModerationOf } from "../products/product-moderation.js";
import { activeImages, mediaUrlBuilder, type MediaUrl } from "../products/product-views.js";
import { caseNotFound } from "./moderation-records.js";

const productNotFound = () => notFound(PRODUCT_ERROR_CODES.notFound);

const caseSummarySelect = {
  id: true,
  productId: true,
  shopId: true,
  status: true,
  outcome: true,
  source: true,
  reportCount: true,
  openedAt: true,
  closedAt: true,
  product: { select: { name: true, moderationStatus: true } },
  shop: { select: { shopName: true } },
} satisfies Prisma.ProductModerationCaseSelect;

type CaseSummaryRow = Prisma.ProductModerationCaseGetPayload<{ select: typeof caseSummarySelect }>;

function toCaseSummary(row: CaseSummaryRow): AdminModerationCaseSummary {
  return {
    id: row.id,
    productId: row.productId,
    productName: row.product.name,
    productModerationStatus: row.product.moderationStatus as ProductModerationStatus,
    shopId: row.shopId,
    shopName: row.shop.shopName,
    status: row.status as ModerationCaseStatus,
    outcome: row.outcome as ModerationCaseOutcome | null,
    source: row.source as ModerationCaseSource,
    reportCount: row.reportCount,
    openedAt: row.openedAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
  };
}

type EventRow = Prisma.ProductModerationEventGetPayload<object>;

function toAdminEvent(row: EventRow): AdminModerationEvent {
  return {
    id: row.id,
    caseId: row.caseId,
    action: row.action as ProductModerationAction,
    fromStatus: row.fromStatus as ProductModerationStatus | null,
    toStatus: row.toStatus as ProductModerationStatus | null,
    actorType: row.actorType as ModerationActorType,
    actorUserId: row.actorUserId,
    sellerReasonCode: row.sellerReasonCode as ProductModerationReason | null,
    sellerMessage: row.sellerMessage,
    sellerNote: row.sellerNote,
    internalReason: row.internalReason,
    internalNote: row.internalNote,
    contentSnapshot: row.contentSnapshot as unknown as ModerationContentSnapshot,
    createdAt: row.createdAt.toISOString(),
  };
}

const EVENT_ORDER = [{ createdAt: "asc" }, { id: "asc" }] satisfies Prisma.ProductModerationEventOrderByWithRelationInput[];

async function closedCaseCounts(db: Prisma.TransactionClient, where: Prisma.ProductModerationCaseWhereInput): Promise<ModerationCaseCounts> {
  const groups = await db.productModerationCase.groupBy({ by: ["outcome"], where: { ...where, status: "CLOSED" }, _count: { _all: true } });
  const count = (outcome: ModerationCaseOutcome) => groups.find((group) => group.outcome === outcome)?._count._all ?? 0;
  const dismissed = count("DISMISSED");
  const restored = count("RESTORED");
  const removed = count("REMOVED");
  return { total: dismissed + restored + removed, dismissed, restored, removed };
}

/**
 * Administrator and seller reads of product moderation (spec 19, sections 5
 * and 6). Administrator views carry everything, including internal reasons and
 * reporter account IDs (PD-10); the seller view carries only seller-facing
 * fields and shows administrators as "Chicman".
 */
export class ModerationQueries {
  private readonly mediaUrl: MediaUrl;

  constructor(
    private readonly prisma: PrismaClient,
    mediaPublicBaseUrl: string,
  ) {
    this.mediaUrl = mediaUrlBuilder(mediaPublicBaseUrl);
  }

  /** `GET /admin/products`: every seller status; newest first. */
  async adminProducts(query: AdminProductListQuery): Promise<AdminProductListResponse> {
    const where: Prisma.ProductWhereInput = {
      ...(query.shopId === undefined ? {} : { shopId: query.shopId }),
      ...(query.moderationStatus === undefined ? {} : { moderationStatus: query.moderationStatus }),
      ...(query.q === undefined
        ? {}
        : {
            OR: [
              { name: { contains: query.q, mode: "insensitive" } },
              { shop: { shopName: { contains: query.q, mode: "insensitive" } } },
            ],
          }),
    };
    const [total, rows] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { images: { ...activeImages, take: 1, select: { objectKey: true } }, shop: { select: { id: true, shopName: true, status: true } } },
      }),
    ]);
    return {
      products: rows.map((row) => ({
        id: row.id,
        name: row.name,
        price: row.price.toFixed(2),
        status: row.status as ProductStatus,
        moderationStatus: row.moderationStatus as ProductModerationStatus,
        moderationUpdatedAt: row.moderationUpdatedAt?.toISOString() ?? null,
        mainImageUrl: row.images[0] === undefined ? null : this.mediaUrl(row.images[0].objectKey),
        shop: { id: row.shop.id, name: row.shop.shopName, status: row.shop.status as ShopStatus },
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  /** `GET /admin/products/:productId`: content, states, shop, cases, and the full history. */
  async adminProduct(productId: string, adminUserId: string, db: Prisma.TransactionClient = this.prisma): Promise<AdminProductDetail> {
    const product = await db.product.findUnique({
      where: { id: productId },
      include: {
        images: activeImages,
        variants: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
        shop: { select: { id: true, shopName: true, status: true, ownerUserId: true } },
      },
    });
    if (product === null) throw productNotFound();
    // Sequential: `db` may be a transaction, which runs one query at a time.
    const openCase = await db.productModerationCase.findFirst({ where: { productId, status: { not: "CLOSED" } }, select: caseSummarySelect });
    const productCounts = await closedCaseCounts(db, { productId });
    const shopCounts = await closedCaseCounts(db, { shopId: product.shopId });
    const events = await db.productModerationEvent.findMany({ where: { productId }, orderBy: EVENT_ORDER });
    const { stock } = productAvailability(product.stock, product.variants);
    return {
      id: product.id,
      status: product.status as ProductStatus,
      moderationStatus: product.moderationStatus as ProductModerationStatus,
      moderationUpdatedAt: product.moderationUpdatedAt?.toISOString() ?? null,
      content: {
        name: product.name,
        description: product.description,
        category: product.category as ProductCategory,
        brand: product.brand,
        price: product.price.toFixed(2),
        images: product.images.map((image) => ({
          id: image.id,
          url: this.mediaUrl(image.objectKey),
          position: image.position,
          contentType: image.contentType as ProductImageContentType,
          sizeBytes: image.sizeBytes,
          width: image.width,
          height: image.height,
        })),
        variants: product.variants.map((variant) => ({
          id: variant.id,
          size: variant.size,
          color: variant.color,
          stock: variant.stock,
          available: isStockAvailable(variant.stock),
          createdAt: variant.createdAt.toISOString(),
          updatedAt: variant.updatedAt.toISOString(),
        })),
      },
      stock,
      shop: { id: product.shop.id, name: product.shop.shopName, status: product.shop.status as ShopStatus, ownerUserId: product.shop.ownerUserId },
      selfAdministered: product.shop.ownerUserId === adminUserId,
      openCase: openCase === null ? null : toCaseSummary(openCase),
      priorCases: { product: productCounts, shop: shopCounts },
      history: events.map(toAdminEvent),
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString(),
    };
  }

  /**
   * `GET /admin/moderation/cases`. Without a status: the queue of non-closed
   * cases, products `IN_REVIEW` first, then oldest first. Closed cases: most
   * recently closed first.
   */
  async cases(query: AdminModerationCaseListQuery): Promise<AdminModerationCaseListResponse> {
    const conditions: Prisma.Sql[] = [
      query.status === undefined ? Prisma.sql`c."status" <> 'CLOSED'` : Prisma.sql`c."status" = ${query.status}::"ProductModerationCaseStatus"`,
    ];
    if (query.shopId !== undefined) conditions.push(Prisma.sql`c."shopId" = ${query.shopId}::uuid`);
    if (query.moderationStatus !== undefined) conditions.push(Prisma.sql`p."moderationStatus" = ${query.moderationStatus}::"ProductModerationStatus"`);
    if (query.q !== undefined) conditions.push(Prisma.sql`p."name" ILIKE ${`%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`}`);
    const where = Prisma.join(conditions, " AND ");
    const order =
      query.status === "CLOSED"
        ? Prisma.sql`c."closedAt" DESC, c."id" DESC`
        : Prisma.sql`(p."moderationStatus" = 'IN_REVIEW') DESC, c."openedAt" ASC, c."id" ASC`;
    const [countRows, idRows] = await Promise.all([
      this.prisma.$queryRaw<{ total: bigint }[]>`
        SELECT count(*) AS "total" FROM "ProductModerationCase" c JOIN "Product" p ON p."id" = c."productId" WHERE ${where}`,
      this.prisma.$queryRaw<{ id: string }[]>`
        SELECT c."id" FROM "ProductModerationCase" c JOIN "Product" p ON p."id" = c."productId"
        WHERE ${where} ORDER BY ${order}
        LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`,
    ]);
    const ids = idRows.map(({ id }) => id);
    const rows = ids.length === 0 ? [] : await this.prisma.productModerationCase.findMany({ where: { id: { in: ids } }, select: caseSummarySelect });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return {
      cases: ids.flatMap((id) => {
        const row = byId.get(id);
        return row === undefined ? [] : [toCaseSummary(row)];
      }),
      page: query.page,
      pageSize: query.pageSize,
      total: Number(countRows[0]?.total ?? 0n),
    };
  }

  /** `GET /admin/moderation/cases/:caseId`. */
  async caseDetail(caseId: string, adminUserId: string, db: Prisma.TransactionClient = this.prisma): Promise<AdminModerationCaseDetail> {
    const row = await db.productModerationCase.findUnique({ where: { id: caseId }, select: caseSummarySelect });
    if (row === null) throw caseNotFound();
    const product = await this.adminProduct(row.productId, adminUserId, db);
    const reports = await db.productReport.findMany({ where: { caseId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    const events = await db.productModerationEvent.findMany({ where: { caseId }, orderBy: EVENT_ORDER });
    const first = events[0];
    return {
      case: toCaseSummary(row),
      snapshot: first === undefined ? null : (first.contentSnapshot as unknown as ModerationContentSnapshot),
      product,
      reports: reports.map(
        (report): AdminProductReport => ({
          id: report.id,
          reasonCode: report.reasonCode as ProductReportReason,
          details: report.details,
          reporterUserId: report.reporterUserId,
          createdAt: report.createdAt.toISOString(),
        }),
      ),
      events: events.map(toAdminEvent),
    };
  }

  /**
   * `GET /sellers/me/products/:productId/moderation`: the seller's own product,
   * any shop status. Another shop's product is `404`. Never a report, a
   * reporter, an internal reason or note, or an administrator's identity.
   */
  async sellerHistory(sellerUserId: string, productId: string, db: Prisma.TransactionClient = this.prisma): Promise<SellerProductModerationResponse> {
    const product = await db.product.findFirst({
      where: { id: productId, shop: { ownerUserId: sellerUserId } },
      select: { id: true, moderationStatus: true, moderationUpdatedAt: true },
    });
    if (product === null) throw productNotFound();
    const moderation = await sellerModerationOf(db, [{ ...product, moderationStatus: product.moderationStatus as ProductModerationStatus }]);
    const events = await db.productModerationEvent.findMany({
      where: { productId, action: { in: [...SELLER_VISIBLE_MODERATION_ACTIONS] } },
      orderBy: EVENT_ORDER,
      select: { id: true, action: true, actorType: true, sellerReasonCode: true, sellerMessage: true, sellerNote: true, createdAt: true },
    });
    const current = moderation.get(product.id);
    if (current === undefined) throw productNotFound();
    return {
      productId: product.id,
      moderation: current,
      history: events.map(
        (event): SellerModerationHistoryEntry => ({
          id: event.id,
          action: event.action as SellerModerationHistoryEntry["action"],
          actor: event.actorType === "SELLER" ? "SELLER" : "CHICMAN",
          reasonCode: event.sellerReasonCode as ProductModerationReason | null,
          message: event.sellerMessage,
          note: event.sellerNote,
          createdAt: event.createdAt.toISOString(),
        }),
      ),
    };
  }
}
