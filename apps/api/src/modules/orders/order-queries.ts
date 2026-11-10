import type {
  AdminOrderListQuery,
  AdminShopOrderDetail,
  AdminShopOrderListResponse,
  CustomerOrder,
  CustomerOrderListQuery,
  CustomerOrderListResponse,
  SellerOrderListQuery,
  SellerShopOrderDetail,
  SellerShopOrderListResponse,
} from "@chicman/shared";

import type { PrismaClient } from "../../lib/prisma.js";
import { mediaUrlBuilder, type MediaUrl } from "../products/product-views.js";
import { listCustomerOrders, loadCustomerOrder } from "./order-views.js";
import { listAdminShopOrders, listSellerShopOrders, loadAdminShopOrder, loadSellerShopOrder } from "./staff-order-views.js";

/** The read side of orders, one view per viewer (spec 11, section 10). */
export class OrderQueries {
  private readonly mediaUrl: MediaUrl;

  constructor(
    private readonly prisma: PrismaClient,
    mediaPublicBaseUrl: string,
  ) {
    this.mediaUrl = mediaUrlBuilder(mediaPublicBaseUrl);
  }

  customerList(userId: string, query: CustomerOrderListQuery): Promise<CustomerOrderListResponse> {
    return listCustomerOrders(this.prisma, userId, query);
  }

  customerOrder(userId: string, orderId: string): Promise<CustomerOrder> {
    return loadCustomerOrder(this.prisma, userId, orderId, this.mediaUrl);
  }

  sellerList(shopId: string, query: SellerOrderListQuery): Promise<SellerShopOrderListResponse> {
    return listSellerShopOrders(this.prisma, shopId, query);
  }

  sellerShopOrder(shopId: string, shopOrderId: string): Promise<SellerShopOrderDetail> {
    return loadSellerShopOrder(this.prisma, shopId, shopOrderId, this.mediaUrl);
  }

  adminList(query: AdminOrderListQuery): Promise<AdminShopOrderListResponse> {
    return listAdminShopOrders(this.prisma, query);
  }

  adminShopOrder(shopOrderId: string, adminUserId: string): Promise<AdminShopOrderDetail> {
    return loadAdminShopOrder(this.prisma, shopOrderId, adminUserId, this.mediaUrl);
  }
}
