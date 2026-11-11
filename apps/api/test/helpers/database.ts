import type { PrismaClient } from "../../src/lib/prisma.js";

/** Valid application fields for shop fixtures (spec 06). */
export const TEST_SHOP_FIELDS = {
  shopName: "Boutique Test",
  description: "Tissus et voiles de qualité.",
  contactPhone: "+22236000000",
  city: "Nouakchott",
  address: "Tevragh Zeina, rue 42",
} as const;

/** Deletes every row of the test database, children before parents. */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.deliveryStatusEvent.deleteMany();
  await prisma.deliveryAttempt.deleteMany();
  await prisma.delivery.deleteMany();
  await prisma.paymentEvent.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.shopOrderStatusEvent.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.shopOrder.deleteMany();
  await prisma.order.deleteMany();
  await prisma.favorite.deleteMany();
  await prisma.cartItem.deleteMany();
  await prisma.cart.deleteMany();
  await prisma.productImageUpload.updateMany({ data: { resultImageId: null, status: "PENDING" } });
  await prisma.productImage.deleteMany();
  await prisma.productImageUpload.deleteMany();
  await prisma.productVariant.deleteMany();
  await prisma.product.deleteMany();
  await prisma.customerAddress.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.notificationEvent.deleteMany();
  await prisma.shopLogoUpload.updateMany({ data: { resultObjectId: null, status: "PENDING" } });
  await prisma.shopLogoObject.deleteMany();
  await prisma.shopLogoUpload.deleteMany();
  await prisma.shopFieldChangeEvent.deleteMany();
  await prisma.shopChangeRequest.deleteMany();
  await prisma.shopStatusEvent.deleteMany();
  await prisma.customerPhoneChange.deleteMany();
  await prisma.customerProfile.deleteMany();
  await prisma.shop.deleteMany();
  await prisma.userRole.deleteMany();
  await prisma.user.deleteMany();
}
