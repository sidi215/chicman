import type { ShopStatus } from "@chicman/shared";

import type { PrismaClient } from "../../lib/prisma.js";

/** The authenticated user's own shop, as needed for seller authorization. */
export interface OwnedShop {
  id: string;
  status: ShopStatus;
}

export interface ShopAccessRepository {
  /** Loads the shop owned by the user (at most one: `Shop.ownerUserId` is unique). */
  findByOwnerUserId(userId: string): Promise<OwnedShop | null>;
}

export class PrismaShopAccessRepository implements ShopAccessRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findByOwnerUserId(userId: string): Promise<OwnedShop | null> {
    return this.prisma.shop.findUnique({
      where: { ownerUserId: userId },
      select: { id: true, status: true },
    });
  }
}
