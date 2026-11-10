import type { SellerDelivery, SellerInProgressDeliveriesResponse } from "@chicman/shared";

import type { PrismaClient } from "../../lib/prisma.js";
import { mediaUrlBuilder, type MediaUrl } from "../products/product-views.js";
import { listInProgressDeliveries, loadSellerDelivery } from "./delivery-views.js";

/** The read side of seller deliveries (spec 12). */
export class DeliveryQueries {
  private readonly mediaUrl: MediaUrl;

  constructor(
    private readonly prisma: PrismaClient,
    mediaPublicBaseUrl: string,
  ) {
    this.mediaUrl = mediaUrlBuilder(mediaPublicBaseUrl);
  }

  sellerDelivery(shopId: string, shopOrderId: string): Promise<SellerDelivery> {
    return loadSellerDelivery(this.prisma, shopId, shopOrderId, this.mediaUrl);
  }

  inProgress(shopId: string): Promise<SellerInProgressDeliveriesResponse> {
    return listInProgressDeliveries(this.prisma, shopId, this.mediaUrl);
  }
}
