import {
  ADDRESS_ERROR_CODES,
  CHECKOUT_ERROR_CODES,
  type CheckoutAddress,
  type CheckoutPlacementInput,
  type CheckoutProblem,
  type CheckoutShop,
  type CheckoutSummary,
  type CustomerOrder,
} from "@chicman/shared";

import { Prisma } from "../../generated/prisma/client.js";
import { HttpError, notFound } from "../../lib/http-error.js";
import type { PrismaClient } from "../../lib/prisma.js";
import { CART_LINE_ORDER, cartLineInclude, cartLineState, type CartLine } from "../cart/cart-lines.js";
import { evaluateCartLine } from "../cart/cart-rules.js";
import type { CartService } from "../cart/cart.service.js";
import { OrderStockUnavailableError } from "../inventory/order-stock.js";
import { recordShopOrderPlaced } from "../notifications/order-notifications.js";
import { createOrder, type DeliverySnapshot, type ShopOrderCreation } from "../orders/order-creation.js";
import { orderAmounts, shopOrderAmounts, type ShopOrderAmounts } from "../orders/order-amounts.js";
import { loadCustomerOrder } from "../orders/order-views.js";
import { createPayment } from "../payments/payments.js";
import { isShopStillApproved } from "../products/product-lock.js";
import { mediaUrlBuilder, type MediaUrl } from "../products/product-views.js";
import { isUniqueViolation } from "../shops/shop.service.js";

type Db = PrismaClient | Prisma.TransactionClient;

/** Test-only fault injection, to prove rollback. */
export interface CheckoutServiceFaults {
  /** Runs after every write of the placement, before the commit. */
  beforeCommit?: () => void | Promise<void>;
  /** Runs once the cart, shops, and products are locked, before they are read. */
  afterLocks?: () => void | Promise<void>;
}

export interface CheckoutOptions {
  mediaPublicBaseUrl: string;
  /** `ORDER_RESPONSE_TIMEOUT_HOURS` (D7). */
  responseTimeoutHours: number;
  faults?: CheckoutServiceFaults;
}

export interface PlacementResult {
  /** `false`: the key was already used; the order it created is returned and nothing is written. */
  created: boolean;
  order: CustomerOrder;
}

const blocked = (): HttpError => new HttpError(409, CHECKOUT_ERROR_CODES.blocked);
const cartEmpty = (): HttpError => new HttpError(409, CHECKOUT_ERROR_CODES.cartEmpty);
const totalsChanged = (): HttpError => new HttpError(409, CHECKOUT_ERROR_CODES.totalsChanged);
const addressNotFound = (): HttpError => notFound(ADDRESS_ERROR_CODES.notFound);

const addressSelect = {
  id: true,
  label: true,
  city: true,
  district: true,
  landmark: true,
  deliveryPhone: true,
  latitude: true,
  longitude: true,
  locationSource: true,
  accuracyMeters: true,
} as const satisfies Prisma.CustomerAddressSelect;

type AddressRow = Prisma.CustomerAddressGetPayload<{ select: typeof addressSelect }>;

/** The checkout's view of a shop, read under its lock at placement. */
const shopSelect = {
  id: true,
  ownerUserId: true,
  shopName: true,
  contactPhone: true,
  whatsappPhone: true,
  deliveryFee: true,
} as const satisfies Prisma.ShopSelect;

/** Placement waits for the locks a busy product can hold; the default 5 s is too tight. */
const PLACEMENT_TIMEOUT_MS = 20_000;

/** The delivery phone: the address's, otherwise the profile's (spec 05, D11). */
const deliveryPhoneOf = (address: AddressRow, profilePhone: string): string => address.deliveryPhone ?? profilePhone;

/**
 * Checkout (spec 10): the summary, and the placement of the whole cart as one
 * order with one shop order per shop, paid in cash on delivery.
 *
 * Every figure is worked out from PostgreSQL with the cart's own rules
 * (`evaluateCartLine`). The client's figures are only compared, never stored.
 * The customer is always the authenticated user.
 */
export class CheckoutService {
  private readonly mediaUrl: MediaUrl;
  private readonly faults: CheckoutServiceFaults;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly cart: CartService,
    private readonly options: CheckoutOptions,
  ) {
    this.mediaUrl = mediaUrlBuilder(options.mediaPublicBaseUrl);
    this.faults = options.faults ?? {};
  }

  /** Writes nothing. Lists every blocking problem; placement checks them all again under locks. */
  async summary(userId: string, addressId: string | undefined): Promise<CheckoutSummary> {
    const address = await this.resolveAddress(this.prisma, userId, addressId);
    const profile = await this.profile(this.prisma, userId);
    const cart = await this.cart.read(userId);
    const shops = await this.prisma.shop.findMany({
      where: { id: { in: cart.shops.map(({ shop }) => shop.id) } },
      select: { id: true, ownerUserId: true, deliveryFee: true },
    });
    const shopById = new Map(shops.map((shop) => [shop.id, shop]));

    const problems: CheckoutProblem[] = [];
    if (cart.shops.length === 0) problems.push({ code: "CART_EMPTY" });
    const groups: CheckoutShop[] = cart.shops.map((group) => {
      const shop = shopById.get(group.shop.id);
      const fee = shop?.deliveryFee ?? null;
      if (shop?.ownerUserId === userId) problems.push({ code: "OWN_SHOP", shopId: group.shop.id });
      if (fee === null) problems.push({ code: "DELIVERY_FEE_NOT_SET", shopId: group.shop.id });
      for (const item of group.items) {
        for (const issue of item.issues) problems.push({ code: issue.code, shopId: group.shop.id, itemId: item.id });
      }
      const subtotal = new Prisma.Decimal(group.subtotal);
      return {
        shop: group.shop,
        items: group.items,
        productsSubtotal: subtotal.toFixed(2),
        deliveryFee: fee === null ? null : fee.toFixed(2),
        total: fee === null ? null : subtotal.plus(fee).toFixed(2),
      };
    });

    const fees = groups.map(({ deliveryFee }) => deliveryFee);
    const allFeesSet = fees.every((fee) => fee !== null);
    const feeTotal = fees.reduce((sum, fee) => sum.plus(fee ?? 0), new Prisma.Decimal(0));
    return {
      shops: groups,
      itemCount: cart.itemCount,
      productsSubtotal: cart.subtotal,
      deliveryFeeTotal: allFeesSet ? feeTotal.toFixed(2) : null,
      total: allFeesSet ? new Prisma.Decimal(cart.subtotal).plus(feeTotal).toFixed(2) : null,
      address: address === null ? null : this.addressView(address, profile.phone),
      defaultRecipientName: profile.fullName ?? "",
      paymentMethod: "CASH_ON_DELIVERY",
      problems,
    };
  }

  /**
   * Places the order (spec 10, section 9). One transaction, in this order: the
   * cart row, the shops (`FOR SHARE`, by ID), the products (`FOR UPDATE`, by
   * ID); validation; the order, shop orders, items, stock, and history (spec
   * 11); one payment per shop order (spec 13); the seller notifications (spec
   * 15); and the removal of the ordered cart lines. Any failure leaves nothing.
   *
   * The idempotency key is checked before and after the cart lock, and the
   * unique (customer, key) constraint settles a race that gets past both.
   */
  async place(userId: string, idempotencyKey: string, input: CheckoutPlacementInput): Promise<PlacementResult> {
    const earlier = await this.orderForKey(this.prisma, userId, idempotencyKey);
    if (earlier !== null) return { created: false, order: earlier };
    try {
      return await this.prisma.$transaction((tx) => this.placeLocked(tx, userId, idempotencyKey, input), { timeout: PLACEMENT_TIMEOUT_MS });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const order = await this.orderForKey(this.prisma, userId, idempotencyKey);
        if (order !== null) return { created: false, order };
      }
      throw error;
    }
  }

  private async placeLocked(tx: Prisma.TransactionClient, userId: string, idempotencyKey: string, input: CheckoutPlacementInput): Promise<PlacementResult> {
    const cartId = await this.lockCart(tx, userId);
    // A request with the same key that committed while this one waited for the cart.
    const repeated = await this.orderForKey(tx, userId, idempotencyKey);
    if (repeated !== null) return { created: false, order: repeated };
    if (cartId === null) throw cartEmpty();
    const targets = await tx.cartItem.findMany({ where: { cartId }, select: { shopId: true, productId: true } });
    if (targets.length === 0) throw cartEmpty();

    const address = await tx.customerAddress.findFirst({ where: { id: input.addressId, userId }, select: addressSelect });
    if (address === null) throw addressNotFound();
    const profile = await this.profile(tx, userId);

    // Same order as the cart (spec 09) and seller writes (spec 07): cart, shop, product.
    const shopIds = [...new Set(targets.map(({ shopId }) => shopId))].sort();
    for (const shopId of shopIds) await isShopStillApproved(tx, shopId);
    const productIds = [...new Set(targets.map(({ productId }) => productId))].sort();
    for (const productId of productIds) await tx.$queryRaw`SELECT 1 FROM "Product" WHERE "id" = ${productId}::uuid FOR UPDATE`;
    await this.faults.afterLocks?.();

    // Read after the locks: nothing from an earlier read is trusted.
    const lines = await tx.cartItem.findMany({ where: { cartId }, include: cartLineInclude, orderBy: CART_LINE_ORDER });
    const shops = await tx.shop.findMany({ where: { id: { in: shopIds } }, select: shopSelect });
    const creations = this.validatedShops(userId, lines, new Map(shops.map((shop) => [shop.id, shop])));
    this.assertExpectedFigures(input.expected, creations);

    const delivery: DeliverySnapshot = {
      recipientName: input.recipientName,
      deliveryPhone: deliveryPhoneOf(address, profile.phone),
      label: address.label,
      city: address.city,
      district: address.district,
      landmark: address.landmark,
      latitude: address.latitude,
      longitude: address.longitude,
      locationSource: address.locationSource,
      accuracyMeters: address.accuracyMeters,
    };
    let order;
    try {
      order = await createOrder(tx, {
        customerUserId: userId,
        idempotencyKey,
        placedAt: new Date(),
        responseTimeoutHours: this.options.responseTimeoutHours,
        delivery,
        shops: creations.map(({ creation }) => creation),
      });
    } catch (error) {
      // Validated under the locks, so only a broken invariant gets here.
      if (error instanceof OrderStockUnavailableError) throw blocked();
      throw error;
    }

    const ownerByShop = new Map(shops.map((shop) => [shop.id, shop.ownerUserId]));
    for (const shopOrder of order.shopOrders) {
      await createPayment(tx, { shopOrderId: shopOrder.id, amountDue: shopOrder.total, customerUserId: userId });
      await recordShopOrderPlaced(tx, {
        sellerUserId: ownerByShop.get(shopOrder.shopId) ?? "",
        orderReference: order.reference,
        shopOrderId: shopOrder.id,
        itemsCount: shopOrder.itemsCount,
        total: shopOrder.total,
        respondBy: shopOrder.respondBy,
      });
    }

    // Every line was ordered (D3), so the cart is left empty.
    await tx.cartItem.deleteMany({ where: { cartId, id: { in: lines.map(({ id }) => id) } } });
    await tx.cart.update({ where: { id: cartId }, data: { updatedAt: new Date() } });

    const view = await loadCustomerOrder(tx, userId, order.id, this.mediaUrl);
    await this.faults.beforeCommit?.();
    return { created: true, order: view };
  }

  /**
   * Re-runs the cart's line rules on fresh data and refuses the whole checkout
   * on any problem of section 8: an unbuyable line, too little stock, an
   * unaccepted price, a shop without a fee, or a shop the customer owns (O2).
   */
  private validatedShops(
    userId: string,
    lines: readonly CartLine[],
    shops: ReadonlyMap<string, Prisma.ShopGetPayload<{ select: typeof shopSelect }>>,
  ): { creation: ShopOrderCreation; amounts: ShopOrderAmounts }[] {
    const grouped = new Map<string, ShopOrderCreation["items"][number][]>();
    for (const line of lines) {
      const evaluation = evaluateCartLine(cartLineState(line));
      if (!evaluation.purchasable || evaluation.issues.length > 0) throw blocked();
      const { product } = line;
      const variant = line.variantId === null ? null : (product.variants.find(({ id }) => id === line.variantId) ?? null);
      const items = grouped.get(line.shopId) ?? [];
      items.push({
        productId: product.id,
        variantId: variant?.id ?? null,
        productName: product.name,
        size: variant?.size ?? null,
        color: variant?.color ?? null,
        imageObjectKey: product.images[0]?.objectKey ?? null,
        unitPrice: product.price,
        quantity: line.quantity,
      });
      grouped.set(line.shopId, items);
    }
    return [...grouped].map(([shopId, items]) => {
      const shop = shops.get(shopId);
      if (shop === undefined || shop.ownerUserId === userId || shop.deliveryFee === null) throw blocked();
      const creation: ShopOrderCreation = {
        shopId,
        shopName: shop.shopName,
        contactPhone: shop.contactPhone,
        whatsappPhone: shop.whatsappPhone,
        deliveryFee: shop.deliveryFee,
        items,
      };
      return { creation, amounts: shopOrderAmounts(items, shop.deliveryFee) };
    });
  }

  /** The customer's figures are a precondition only: any difference refuses the placement. */
  private assertExpectedFigures(expected: CheckoutPlacementInput["expected"], shops: readonly { creation: ShopOrderCreation; amounts: ShopOrderAmounts }[]): void {
    const same = (shown: string, actual: Prisma.Decimal) => new Prisma.Decimal(shown).equals(actual);
    const shownByShop = new Map(expected.shops.map((shop) => [shop.shopId, shop]));
    if (shownByShop.size !== expected.shops.length || shownByShop.size !== shops.length) throw totalsChanged();
    for (const { creation, amounts } of shops) {
      const shown = shownByShop.get(creation.shopId);
      if (shown === undefined || !same(shown.productsSubtotal, amounts.productsSubtotal) || !same(shown.deliveryFee, amounts.deliveryFee)) {
        throw totalsChanged();
      }
    }
    if (!same(expected.total, orderAmounts(shops.map(({ amounts }) => amounts)).total)) throw totalsChanged();
  }

  private async orderForKey(db: Db, userId: string, idempotencyKey: string): Promise<CustomerOrder | null> {
    const order = await db.order.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } }, select: { id: true } });
    return order === null ? null : loadCustomerOrder(db, userId, order.id, this.mediaUrl);
  }

  private async lockCart(tx: Prisma.TransactionClient, userId: string): Promise<string | null> {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Cart" WHERE "userId" = ${userId}::uuid FOR UPDATE`;
    return rows[0]?.id ?? null;
  }

  /** The chosen address (only the customer's own), else the default one, else `null`. */
  private async resolveAddress(db: Db, userId: string, addressId: string | undefined): Promise<AddressRow | null> {
    if (addressId !== undefined) {
      const address = await db.customerAddress.findFirst({ where: { id: addressId, userId }, select: addressSelect });
      if (address === null) throw addressNotFound();
      return address;
    }
    return db.customerAddress.findFirst({
      where: { userId },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }, { id: "asc" }],
      select: addressSelect,
    });
  }

  private async profile(db: Db, userId: string): Promise<{ fullName: string | null; phone: string }> {
    // Every bootstrapped user has one (spec 04).
    return db.customerProfile.findUniqueOrThrow({ where: { userId }, select: { fullName: true, phone: true } });
  }

  private addressView(address: AddressRow, profilePhone: string): CheckoutAddress {
    return {
      addressId: address.id,
      label: address.label,
      city: address.city,
      district: address.district,
      landmark: address.landmark,
      deliveryPhone: deliveryPhoneOf(address, profilePhone),
      latitude: address.latitude.toNumber(),
      longitude: address.longitude.toNumber(),
      locationSource: address.locationSource,
      accuracyMeters: address.accuracyMeters,
    };
  }
}
