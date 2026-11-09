import type { AdminShopDetailResponse, AdminShopListResponse, ShopStatus } from "@chicman/shared";

import type { PrismaClient } from "../../lib/prisma.js";
import { assertNotOwnShop } from "../shops/shop-lifecycle.js";

export interface AdminShopListFilter {
  status?: ShopStatus;
  openChangeRequest?: boolean;
  limit: number;
}

/** Administrator read models: review list and full shop history (spec 06, Audit). */
export class AdminShopQueries {
  constructor(private readonly prisma: PrismaClient) {}

  async list(filter: AdminShopListFilter): Promise<AdminShopListResponse> {
    const shops = await this.prisma.shop.findMany({
      where: {
        ...(filter.status === undefined ? {} : { status: filter.status }),
        ...(filter.openChangeRequest === undefined
          ? {}
          : { changeRequests: filter.openChangeRequest ? { some: { status: "PENDING" } } : { none: { status: "PENDING" } } }),
      },
      // Oldest first: the review queue.
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: filter.limit,
      select: {
        id: true,
        ownerUserId: true,
        status: true,
        shopName: true,
        city: true,
        createdAt: true,
        updatedAt: true,
        changeRequests: { where: { status: "PENDING" }, select: { id: true }, take: 1 },
      },
    });
    return {
      shops: shops.map((shop) => ({
        id: shop.id,
        ownerUserId: shop.ownerUserId,
        status: shop.status,
        shopName: shop.shopName,
        city: shop.city,
        createdAt: shop.createdAt.toISOString(),
        updatedAt: shop.updatedAt.toISOString(),
        hasOpenChangeRequest: shop.changeRequests.length > 0,
      })),
    };
  }

  /**
   * Full administrative history. An administrator cannot read it for a shop
   * they own (`403`): it carries internal reasons and notes that the owner
   * never sees.
   */
  async detail(shopId: string, adminUserId: string): Promise<AdminShopDetailResponse | null> {
    const shop = await this.prisma.shop.findUnique({
      where: { id: shopId },
      select: {
        id: true,
        ownerUserId: true,
        status: true,
        shopName: true,
        description: true,
        contactPhone: true,
        whatsappPhone: true,
        city: true,
        address: true,
        logoUrl: true,
        deliveryFee: true,
        createdAt: true,
        updatedAt: true,
        statusEvents: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
        fieldChanges: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
        changeRequests: { orderBy: [{ submittedAt: "asc" }, { id: "asc" }] },
      },
    });
    if (shop === null) return null;
    assertNotOwnShop(shop, adminUserId);
    return {
      shop: {
        id: shop.id,
        ownerUserId: shop.ownerUserId,
        status: shop.status,
        shopName: shop.shopName,
        description: shop.description,
        contactPhone: shop.contactPhone,
        whatsappPhone: shop.whatsappPhone,
        city: shop.city,
        address: shop.address,
        logoUrl: shop.logoUrl,
        deliveryFee: shop.deliveryFee === null ? null : shop.deliveryFee.toFixed(2),
        createdAt: shop.createdAt.toISOString(),
        updatedAt: shop.updatedAt.toISOString(),
      },
      statusEvents: shop.statusEvents.map((event) => ({
        id: event.id,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        actorUserId: event.actorUserId,
        decisionType: event.decisionType,
        internalReason: event.internalReason,
        applicantReason: event.applicantReason,
        internalNote: event.internalNote,
        createdAt: event.createdAt.toISOString(),
      })),
      fieldChanges: shop.fieldChanges.map((change) => ({
        id: change.id,
        field: change.field,
        oldValue: change.oldValue,
        newValue: change.newValue,
        actorUserId: change.actorUserId,
        source: change.source,
        createdAt: change.createdAt.toISOString(),
      })),
      changeRequests: shop.changeRequests.map((request) => ({
        id: request.id,
        proposedShopName: request.proposedShopName,
        proposedCity: request.proposedCity,
        status: request.status,
        submittedByUserId: request.submittedByUserId,
        submittedAt: request.submittedAt.toISOString(),
        decidedByUserId: request.decidedByUserId,
        decidedAt: request.decidedAt?.toISOString() ?? null,
        internalReason: request.internalReason,
        internalNote: request.internalNote,
      })),
    };
  }
}
