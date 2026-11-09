import { randomUUID } from "node:crypto";

import {
  CART_ERROR_CODES,
  CART_MAX_ITEMS,
  PRODUCT_ERROR_CODES,
  type Cart,
  type CartItem,
  type CartItemAddInput,
  type CartShopGroup,
} from "@chicman/shared";

import { Prisma } from "../../generated/prisma/client.js";
import { HttpError, notFound } from "../../lib/http-error.js";
import type { PrismaClient } from "../../lib/prisma.js";
import { isQuantityAvailable } from "../inventory/availability.js";
import { isShopStillApproved } from "../products/product-lock.js";
import { mediaUrlBuilder, type MediaUrl } from "../products/product-views.js";
import { productVisibility } from "../products/product-visibility.js";
import { CART_LINE_ORDER as LINE_ORDER, cartLineInclude as lineInclude, cartLineProduct as productState, cartLineState as lineState, type CartLine as Line } from "./cart-lines.js";
import { evaluateCartLine } from "./cart-rules.js";

const itemNotFound = (): HttpError => notFound(CART_ERROR_CODES.itemNotFound);
const insufficientStock = (): HttpError => new HttpError(409, CART_ERROR_CODES.insufficientStock);

/** Test-only fault injection, to prove rollback. */
export interface CartServiceFaults {
  beforeCommit?: () => void | Promise<void>;
}

/**
 * The customer's cart (spec 09). Every operation targets the authenticated
 * user's own cart, so another customer's line is `404`. Prices, availability,
 * and totals are worked out from PostgreSQL on every read and write; the client
 * only ever sends IDs and quantities.
 *
 * Lock order: cart, then shop, then product (the same shop-then-product order as
 * seller changes). The cart lock serializes one customer's changes, and the
 * shared locks hold what was validated until the commit: a suspension or a
 * variant removal waits for this transaction. No stock is reserved.
 */
export class CartService {
  private readonly mediaUrl: MediaUrl;

  constructor(
    private readonly prisma: PrismaClient,
    mediaPublicBaseUrl: string,
    private readonly faults: CartServiceFaults = {},
  ) {
    this.mediaUrl = mediaUrlBuilder(mediaPublicBaseUrl);
  }

  /** Never writes: having no cart yet reads as an empty one. */
  read(userId: string): Promise<Cart> {
    return this.loadCart(this.prisma, userId);
  }

  async addItem(userId: string, input: CartItemAddInput): Promise<Cart> {
    return this.prisma.$transaction(async (tx) => {
      const cartId = await this.lockOrCreateCart(tx, userId);
      const product = await this.lockedProduct(tx, input.productId);
      if (product === null) throw notFound(PRODUCT_ERROR_CODES.notFound);
      const visibility = productVisibility({ status: product.status, shopStatus: product.shop.status, hasActiveImage: product.images.length > 0 });
      if (visibility !== "PUBLIC") throw notFound(PRODUCT_ERROR_CODES.notFound);

      const variant = this.chosenVariant(product, input.variantId);
      const stock = variant?.stock ?? product.stock;
      const existing = await tx.cartItem.findFirst({
        where: {
          cartId,
          productId: product.id,
          ...(variant === null ? { variantId: null, variantSize: null, variantColor: null } : { variantId: variant.id }),
        },
        select: { id: true, quantity: true },
      });
      const quantity = (existing?.quantity ?? 0) + input.quantity;
      if (!isQuantityAvailable(stock, quantity)) throw insufficientStock();

      // The customer has just chosen this variant, so its current values are the choice.
      const choice = { variantSize: variant?.size ?? null, variantColor: variant?.color ?? null };
      if (existing === null) {
        if ((await tx.cartItem.count({ where: { cartId } })) >= CART_MAX_ITEMS) throw new HttpError(409, CART_ERROR_CODES.limitReached);
        await tx.cartItem.create({
          data: { cartId, productId: product.id, shopId: product.shop.id, variantId: variant?.id ?? null, ...choice, quantity, priceSnapshot: product.price },
        });
      } else {
        // The snapshot is kept: adding more does not acknowledge a price change.
        await tx.cartItem.update({ where: { id: existing.id }, data: { quantity, ...choice } });
      }
      return this.finish(tx, cartId, userId);
    });
  }

  /** Checks the new quantity against the stock now. The stored price is left as it is. */
  async updateQuantity(userId: string, itemId: string, quantity: number): Promise<Cart> {
    return this.changeLine(userId, itemId, async (tx, line) => {
      const { removeOnly, stock } = evaluateCartLine(lineState(line));
      if (removeOnly) throw new HttpError(409, CART_ERROR_CODES.itemUnavailable);
      if (!isQuantityAvailable(stock ?? 0, quantity)) throw insufficientStock();
      await tx.cartItem.update({ where: { id: itemId }, data: { quantity } });
    });
  }

  /**
   * The customer acknowledges a price change. `seenPrice` is only compared with
   * the current price, so a price that changed again after they read the cart is
   * refused rather than accepted on their behalf.
   */
  async acceptPrice(userId: string, itemId: string, seenPrice: string): Promise<Cart> {
    return this.changeLine(userId, itemId, async (tx, line) => {
      if (evaluateCartLine(lineState(line)).removeOnly) throw new HttpError(409, CART_ERROR_CODES.itemUnavailable);
      if (!line.product.price.equals(new Prisma.Decimal(seenPrice))) throw new HttpError(409, CART_ERROR_CODES.priceChanged);
      await tx.cartItem.update({ where: { id: itemId }, data: { priceSnapshot: line.product.price } });
    });
  }

  async removeItem(userId: string, itemId: string): Promise<Cart> {
    return this.prisma.$transaction(async (tx) => {
      const cartId = await this.lockCart(tx, userId);
      if (cartId === null) throw itemNotFound();
      const removed = await tx.cartItem.deleteMany({ where: { id: itemId, cartId } });
      if (removed.count === 0) throw itemNotFound();
      return this.finish(tx, cartId, userId);
    });
  }

  /** Empties the cart. Clearing an empty cart succeeds. */
  async clear(userId: string): Promise<Cart> {
    return this.prisma.$transaction(async (tx) => {
      const cartId = await this.lockCart(tx, userId);
      if (cartId === null) return this.loadCart(tx, userId);
      await tx.cartItem.deleteMany({ where: { cartId } });
      return this.finish(tx, cartId, userId);
    });
  }

  private changeLine(userId: string, itemId: string, change: (tx: Prisma.TransactionClient, line: Line) => Promise<void>): Promise<Cart> {
    return this.prisma.$transaction(async (tx) => {
      const cartId = await this.lockCart(tx, userId);
      if (cartId === null) throw itemNotFound();
      const target = await tx.cartItem.findFirst({ where: { id: itemId, cartId }, select: { productId: true, shopId: true } });
      if (target === null) throw itemNotFound();
      await this.shareLocks(tx, target.shopId, target.productId);
      // Read after the locks, so the rules see the state that holds until the commit.
      await change(tx, await tx.cartItem.findUniqueOrThrow({ where: { id: itemId }, include: lineInclude }));
      return this.finish(tx, cartId, userId);
    });
  }

  private async finish(tx: Prisma.TransactionClient, cartId: string, userId: string): Promise<Cart> {
    await tx.cart.update({ where: { id: cartId }, data: { updatedAt: new Date() } });
    const cart = await this.loadCart(tx, userId);
    await this.faults.beforeCommit?.();
    return cart;
  }

  /** The variant the request selects, verified to belong to this product. */
  private chosenVariant(
    product: { variants: readonly { id: string; size: string | null; color: string | null; stock: number }[] },
    variantId: string | undefined,
  ): { id: string; size: string | null; color: string | null; stock: number } | null {
    if (variantId === undefined) {
      if (product.variants.length > 0) throw new HttpError(409, CART_ERROR_CODES.variantRequired);
      return null;
    }
    const variant = product.variants.find(({ id }) => id === variantId);
    if (variant === undefined) throw notFound(CART_ERROR_CODES.variantNotFound);
    return variant;
  }

  private async lockCart(tx: Prisma.TransactionClient, userId: string): Promise<string | null> {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Cart" WHERE "userId" = ${userId}::uuid FOR UPDATE`;
    return rows[0]?.id ?? null;
  }

  /** A failed first add rolls back, so a cart exists only once it has held something. */
  private async lockOrCreateCart(tx: Prisma.TransactionClient, userId: string): Promise<string> {
    await tx.$executeRaw`
      INSERT INTO "Cart" ("id", "userId", "updatedAt") VALUES (${randomUUID()}::uuid, ${userId}::uuid, NOW())
      ON CONFLICT ("userId") DO NOTHING`;
    const cartId = await this.lockCart(tx, userId);
    if (cartId === null) throw new Error("cart row missing after insert");
    return cartId;
  }

  private async shareLocks(tx: Prisma.TransactionClient, shopId: string, productId: string): Promise<void> {
    await isShopStillApproved(tx, shopId);
    await tx.$queryRaw`SELECT 1 FROM "Product" WHERE "id" = ${productId}::uuid FOR SHARE`;
  }

  private async lockedProduct(tx: Prisma.TransactionClient, productId: string) {
    const owner = await tx.product.findUnique({ where: { id: productId }, select: { shopId: true } });
    if (owner === null) return null;
    await this.shareLocks(tx, owner.shopId, productId);
    return tx.product.findUnique({ where: { id: productId }, select: productState });
  }

  private async loadCart(db: Prisma.TransactionClient, userId: string): Promise<Cart> {
    const lines = await db.cartItem.findMany({ where: { cart: { userId } }, include: lineInclude, orderBy: LINE_ORDER });

    const groups = new Map<string, { shop: CartShopGroup["shop"]; items: CartItem[]; subtotal: Prisma.Decimal }>();
    let itemCount = 0;
    let total = new Prisma.Decimal(0);
    for (const line of lines) {
      const { unitPrice, issues, purchasable } = evaluateCartLine(lineState(line));
      const { product } = line;
      const subtotal = unitPrice.times(line.quantity);
      const group = groups.get(product.shop.id) ?? { shop: { id: product.shop.id, name: product.shop.shopName }, items: [], subtotal: new Prisma.Decimal(0) };
      group.items.push({
        id: line.id,
        productId: product.id,
        variantId: line.variantId,
        name: product.name,
        imageUrl: product.images[0] === undefined ? null : this.mediaUrl(product.images[0].objectKey),
        size: line.variantSize,
        color: line.variantColor,
        quantity: line.quantity,
        unitPrice: unitPrice.toFixed(2),
        subtotal: subtotal.toFixed(2),
        purchasable,
        issues,
      });
      if (purchasable) {
        group.subtotal = group.subtotal.plus(subtotal);
        total = total.plus(subtotal);
      }
      groups.set(product.shop.id, group);
      itemCount += line.quantity;
    }
    return {
      shops: [...groups.values()].map(({ shop, items, subtotal }) => ({ shop, items, subtotal: subtotal.toFixed(2) })),
      itemCount,
      subtotal: total.toFixed(2),
    };
  }
}
