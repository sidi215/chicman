import {
  PRODUCT_ERROR_CODES,
  PRODUCT_MAX_VARIANTS,
  type ProductCreateInput,
  type ProductImageOrderInput,
  type ProductListQuery,
  type ProductUpdateInput,
  type SellerProductDetail,
  type SellerProductListResponse,
  type VariantCreateInput,
  type VariantUpdateInput,
} from "@chicman/shared";

import type { Prisma } from "../../generated/prisma/client.js";
import { badRequest, forbidden, HttpError, notFound } from "../../lib/http-error.js";
import type { PrismaClient } from "../../lib/prisma.js";
import { isUniqueViolation } from "../shops/shop.service.js";
import {
  isShopStillApproved,
  touchProduct,
  withEditableProduct,
  withLockedProduct,
  type ProductSeller,
} from "./product-lock.js";
import {
  loadProductDetail,
  mediaUrlBuilder,
  productDetailInclude,
  productSummaryInclude,
  toProductDetail,
  toProductSummary,
  type MediaUrl,
} from "./product-views.js";

const statusConflict = (): HttpError => new HttpError(409, PRODUCT_ERROR_CODES.statusConflict);
const variantNotFound = (): HttpError => notFound(PRODUCT_ERROR_CODES.variantNotFound);
const variantExists = (): HttpError => new HttpError(409, PRODUCT_ERROR_CODES.variantAlreadyExists);

/**
 * Seller product operations (spec 07). The shop always comes from the
 * authenticated user, and every lookup is scoped to it, so another shop's
 * product resolves to `404`. Products are never deleted.
 */
export class ProductService {
  private readonly mediaUrl: MediaUrl;

  /** `mediaPublicBaseUrl`: empty when storage is not configured (no image can exist then). */
  constructor(
    private readonly prisma: PrismaClient,
    mediaPublicBaseUrl: string,
  ) {
    this.mediaUrl = mediaUrlBuilder(mediaPublicBaseUrl);
  }

  async create(seller: ProductSeller, input: ProductCreateInput): Promise<SellerProductDetail> {
    return this.prisma.$transaction(async (tx) => {
      if (!(await isShopStillApproved(tx, seller.shopId))) throw forbidden();
      const product = await tx.product.create({
        data: {
          shopId: seller.shopId,
          name: input.name,
          description: input.description,
          category: input.category,
          brand: input.brand ?? null,
          price: input.price,
          stock: input.stock ?? 0,
        },
        include: productDetailInclude,
      });
      return toProductDetail(product, this.mediaUrl);
    });
  }

  async list(seller: ProductSeller, query: ProductListQuery): Promise<SellerProductListResponse> {
    const where: Prisma.ProductWhereInput = { shopId: seller.shopId, ...(query.status === undefined ? {} : { status: query.status }) };
    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: productSummaryInclude,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.product.count({ where }),
    ]);
    return {
      products: products.map((product) => toProductSummary(product, this.mediaUrl)),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  get(seller: ProductSeller, productId: string): Promise<SellerProductDetail> {
    return loadProductDetail(this.prisma, seller, productId, this.mediaUrl);
  }

  update(seller: ProductSeller, productId: string, input: ProductUpdateInput): Promise<SellerProductDetail> {
    return withEditableProduct(this.prisma, seller, productId, async (tx) => {
      await tx.product.update({
        where: { id: productId },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.description === undefined ? {} : { description: input.description }),
          ...(input.category === undefined ? {} : { category: input.category }),
          ...(input.brand === undefined ? {} : { brand: input.brand }),
          ...(input.price === undefined ? {} : { price: input.price }),
        },
      });
      return loadProductDetail(tx, seller, productId, this.mediaUrl);
    });
  }

  /** `DRAFT` → `PUBLISHED`, in an approved shop, with at least one image. */
  publish(seller: ProductSeller, productId: string): Promise<SellerProductDetail> {
    return withLockedProduct(this.prisma, seller, productId, async (tx, product) => {
      if (product.status !== "DRAFT") throw statusConflict();
      const images = await tx.productImage.count({ where: { productId, status: "ACTIVE" } });
      if (images === 0) throw new HttpError(409, PRODUCT_ERROR_CODES.publishRequiresImage);
      await tx.product.update({ where: { id: productId }, data: { status: "PUBLISHED", publishedAt: new Date() } });
      return loadProductDetail(tx, seller, productId, this.mediaUrl);
    });
  }

  /**
   * `ARCHIVED` → `DRAFT`. Information, images, variants, and stock are untouched.
   * Restoring never publishes: the seller publishes again under the normal
   * rules. `publishedAt` keeps the last publication until then.
   */
  restore(seller: ProductSeller, productId: string): Promise<SellerProductDetail> {
    return withLockedProduct(this.prisma, seller, productId, async (tx, product) => {
      if (product.status !== "ARCHIVED") throw statusConflict();
      await tx.product.update({ where: { id: productId }, data: { status: "DRAFT", archivedAt: null } });
      return loadProductDetail(tx, seller, productId, this.mediaUrl);
    });
  }

  /** `DRAFT` or `PUBLISHED` → `ARCHIVED`. The row and its images are kept. */
  archive(seller: ProductSeller, productId: string): Promise<SellerProductDetail> {
    return withLockedProduct(this.prisma, seller, productId, async (tx, product) => {
      if (product.status === "ARCHIVED") throw statusConflict();
      await tx.product.update({ where: { id: productId }, data: { status: "ARCHIVED", archivedAt: new Date() } });
      return loadProductDetail(tx, seller, productId, this.mediaUrl);
    });
  }

  /**
   * Adds a variant. The first variant moves stock management to the variants:
   * the product's own stock is cleared, so an old value cannot come back when
   * the last variant is removed.
   */
  async addVariant(seller: ProductSeller, productId: string, input: VariantCreateInput): Promise<SellerProductDetail> {
    try {
      return await withEditableProduct(this.prisma, seller, productId, async (tx) => {
        const count = await tx.productVariant.count({ where: { productId } });
        if (count >= PRODUCT_MAX_VARIANTS) throw new HttpError(409, PRODUCT_ERROR_CODES.variantLimitReached);
        await tx.productVariant.create({
          data: { productId, size: input.size ?? null, color: input.color ?? null, stock: input.stock ?? 0 },
        });
        if (count === 0) await tx.product.update({ where: { id: productId }, data: { stock: 0 } });
        else await touchProduct(tx, productId);
        return loadProductDetail(tx, seller, productId, this.mediaUrl);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw variantExists();
      throw error;
    }
  }

  async updateVariant(seller: ProductSeller, productId: string, variantId: string, input: VariantUpdateInput): Promise<SellerProductDetail> {
    try {
      return await withEditableProduct(this.prisma, seller, productId, async (tx) => {
        const variant = await tx.productVariant.findFirst({ where: { id: variantId, productId } });
        if (variant === null) throw variantNotFound();
        const size = input.size === undefined ? variant.size : input.size;
        const color = input.color === undefined ? variant.color : input.color;
        if (size === null && color === null) throw badRequest(PRODUCT_ERROR_CODES.variantAttributeRequired);
        await tx.productVariant.update({ where: { id: variantId }, data: { size, color } });
        await touchProduct(tx, productId);
        return loadProductDetail(tx, seller, productId, this.mediaUrl);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw variantExists();
      throw error;
    }
  }

  /** Removing the last variant returns the product to its own stock, at zero. */
  removeVariant(seller: ProductSeller, productId: string, variantId: string): Promise<SellerProductDetail> {
    return withEditableProduct(this.prisma, seller, productId, async (tx) => {
      const removed = await tx.productVariant.deleteMany({ where: { id: variantId, productId } });
      if (removed.count === 0) throw variantNotFound();
      await touchProduct(tx, productId);
      return loadProductDetail(tx, seller, productId, this.mediaUrl);
    });
  }

  /**
   * Removes an image from the product. Its bytes are deleted later by the
   * cleanup job. A published product always keeps one image.
   */
  removeImage(seller: ProductSeller, productId: string, imageId: string): Promise<SellerProductDetail> {
    return withEditableProduct(this.prisma, seller, productId, async (tx, product) => {
      const image = await tx.productImage.findFirst({ where: { id: imageId, productId, status: "ACTIVE" } });
      if (image === null) throw notFound(PRODUCT_ERROR_CODES.imageNotFound);
      if (product.status === "PUBLISHED") {
        const active = await tx.productImage.count({ where: { productId, status: "ACTIVE" } });
        if (active <= 1) throw new HttpError(409, PRODUCT_ERROR_CODES.lastImageRequired);
      }
      await tx.productImage.update({ where: { id: imageId }, data: { status: "RELEASED", releasedAt: new Date() } });
      await touchProduct(tx, productId);
      return loadProductDetail(tx, seller, productId, this.mediaUrl);
    });
  }

  /** Sets the display order. The list must name every active image exactly once. */
  reorderImages(seller: ProductSeller, productId: string, input: ProductImageOrderInput): Promise<SellerProductDetail> {
    return withEditableProduct(this.prisma, seller, productId, async (tx) => {
      const active = await tx.productImage.findMany({ where: { productId, status: "ACTIVE" }, select: { id: true } });
      const activeIds = new Set(active.map((image) => image.id));
      if (input.imageIds.length !== activeIds.size || !input.imageIds.every((id) => activeIds.has(id))) {
        throw badRequest(PRODUCT_ERROR_CODES.imageOrderInvalid);
      }
      for (const [position, id] of input.imageIds.entries()) {
        await tx.productImage.update({ where: { id }, data: { position } });
      }
      await touchProduct(tx, productId);
      return loadProductDetail(tx, seller, productId, this.mediaUrl);
    });
  }
}
