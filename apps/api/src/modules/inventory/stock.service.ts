import { PRODUCT_ERROR_CODES, type SellerProductDetail, type StockUpdateInput } from "@chicman/shared";

import { HttpError, notFound } from "../../lib/http-error.js";
import type { PrismaClient } from "../../lib/prisma.js";
import { touchProduct, withEditableProduct, type ProductSeller } from "../products/product-lock.js";
import { loadProductDetail, mediaUrlBuilder, type MediaUrl } from "../products/product-views.js";

const stockConflict = (): HttpError => new HttpError(409, PRODUCT_ERROR_CODES.stockConflict);

/**
 * Seller stock updates (spec 07, section 7). Each one is a compare-and-set
 * under the product lock: the new value applies only if the stock is still
 * the value the seller saw. Negative values are refused by validation and by
 * a database constraint. Checkout reservation is out of scope here.
 */
export class StockService {
  private readonly mediaUrl: MediaUrl;

  constructor(
    private readonly prisma: PrismaClient,
    mediaPublicBaseUrl: string,
  ) {
    this.mediaUrl = mediaUrlBuilder(mediaPublicBaseUrl);
  }

  /** Stock of a product without variants. */
  setProductStock(seller: ProductSeller, productId: string, input: StockUpdateInput): Promise<SellerProductDetail> {
    return withEditableProduct(this.prisma, seller, productId, async (tx, product) => {
      const variants = await tx.productVariant.count({ where: { productId } });
      if (variants > 0) throw new HttpError(409, PRODUCT_ERROR_CODES.stockManagedByVariants);
      if (product.stock !== input.expectedStock) throw stockConflict();
      await tx.product.update({ where: { id: productId }, data: { stock: input.stock } });
      return loadProductDetail(tx, seller, productId, this.mediaUrl);
    });
  }

  /** Stock of one variant of this product. */
  setVariantStock(seller: ProductSeller, productId: string, variantId: string, input: StockUpdateInput): Promise<SellerProductDetail> {
    return withEditableProduct(this.prisma, seller, productId, async (tx) => {
      const variant = await tx.productVariant.findFirst({ where: { id: variantId, productId } });
      if (variant === null) throw notFound(PRODUCT_ERROR_CODES.variantNotFound);
      if (variant.stock !== input.expectedStock) throw stockConflict();
      await tx.productVariant.update({ where: { id: variantId }, data: { stock: input.stock } });
      await touchProduct(tx, productId);
      return loadProductDetail(tx, seller, productId, this.mediaUrl);
    });
  }
}
