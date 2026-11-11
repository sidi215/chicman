import { FAVORITE_ERROR_CODES, FAVORITES_MAX_ITEMS, PRODUCT_ERROR_CODES, type FavoriteItem, type FavoriteList } from "@chicman/shared";

import type { Prisma } from "../../generated/prisma/client.js";
import { HttpError, notFound } from "../../lib/http-error.js";
import type { PrismaClient } from "../../lib/prisma.js";
import { productAvailability } from "../inventory/availability.js";
import { publicSummaryInclude, toPublicProductSummary } from "../products/catalog.service.js";
import { mediaUrlBuilder, type MediaUrl } from "../products/product-views.js";
import { PUBLIC_PRODUCT_WHERE, productVisibility } from "../products/product-visibility.js";

/** The product as the card needs it, plus the shop status for the visibility rule. */
const favoriteInclude = {
  product: {
    include: { ...publicSummaryInclude, shop: { select: { id: true, shopName: true, status: true } } },
  },
} satisfies Prisma.FavoriteInclude;

type FavoriteRow = Prisma.FavoriteGetPayload<{ include: typeof favoriteInclude }>;

/** Most recently added first; the ID breaks ties. */
const FAVORITE_ORDER = [{ createdAt: "desc" }, { id: "desc" }] satisfies Prisma.FavoriteOrderByWithRelationInput[];

/** Test-only fault injection, to prove rollback. */
export interface FavoriteServiceFaults {
  beforeCommit?: () => void | Promise<void>;
}

/**
 * The customer's favorites (spec 14). Every operation targets the authenticated
 * user's own list: the owner always comes from the verified token. A favorite
 * stores only the product reference, and every read shows the product's current
 * state through `PUBLIC_PRODUCT_WHERE` and the availability rule, so a hidden
 * product is shown as unavailable with no price, and never becomes purchasable:
 * buying still goes through the cart, which validates it again. Nothing here
 * touches the cart.
 */
export class FavoriteService {
  private readonly mediaUrl: MediaUrl;

  constructor(
    private readonly prisma: PrismaClient,
    mediaPublicBaseUrl: string,
    private readonly faults: FavoriteServiceFaults = {},
  ) {
    this.mediaUrl = mediaUrlBuilder(mediaPublicBaseUrl);
  }

  list(userId: string): Promise<FavoriteList> {
    return this.load(this.prisma, userId);
  }

  /**
   * Idempotent: adding a product already in the list succeeds and changes
   * nothing, even if the product has since been hidden. A new favorite needs a
   * publicly visible product; a hidden or unknown one is the same `404`.
   */
  async add(userId: string, productId: string): Promise<FavoriteList> {
    return this.prisma.$transaction(async (tx) => {
      // Serializes one customer's additions, so the limit holds under concurrent requests.
      await tx.$queryRaw`SELECT 1 FROM "User" WHERE "id" = ${userId}::uuid FOR NO KEY UPDATE`;
      const existing = await tx.favorite.findUnique({ where: { userId_productId: { userId, productId } }, select: { id: true } });
      if (existing === null) {
        const product = await tx.product.findFirst({ where: { AND: [PUBLIC_PRODUCT_WHERE, { id: productId }] }, select: { id: true } });
        if (product === null) throw notFound(PRODUCT_ERROR_CODES.notFound);
        if ((await tx.favorite.count({ where: { userId } })) >= FAVORITES_MAX_ITEMS) throw new HttpError(409, FAVORITE_ERROR_CODES.limitReached);
        // The unique pair makes a duplicate impossible even outside this lock.
        await tx.favorite.createMany({ data: [{ userId, productId }], skipDuplicates: true });
      }
      const list = await this.load(tx, userId);
      await this.faults.beforeCommit?.();
      return list;
    });
  }

  /** Idempotent: removing a product that is not in the list succeeds. The product itself is untouched. */
  async remove(userId: string, productId: string): Promise<FavoriteList> {
    await this.prisma.favorite.deleteMany({ where: { userId, productId } });
    return this.load(this.prisma, userId);
  }

  private async load(db: Prisma.TransactionClient, userId: string): Promise<FavoriteList> {
    const rows = await db.favorite.findMany({ where: { userId }, include: favoriteInclude, orderBy: FAVORITE_ORDER, take: FAVORITES_MAX_ITEMS });
    return { items: rows.map((row) => this.toItem(row)) };
  }

  private toItem({ product, productId, createdAt }: FavoriteRow): FavoriteItem {
    const mainImageKey = product.images[0]?.objectKey;
    const base = {
      productId,
      addedAt: createdAt.toISOString(),
      name: product.name,
      imageUrl: mainImageKey === undefined ? null : this.mediaUrl(mainImageKey),
    };
    const visibility = productVisibility({ status: product.status, shopStatus: product.shop.status, hasActiveImage: mainImageKey !== undefined });
    // The price, shop, and link of a hidden product stay private, and so does the reason it is hidden.
    if (visibility !== "PUBLIC") return { ...base, state: "UNAVAILABLE", product: null };
    const { available } = productAvailability(product.stock, product.variants);
    return { ...base, state: available ? "AVAILABLE" : "SOLD_OUT", product: toPublicProductSummary(product, this.mediaUrl) };
  }
}
