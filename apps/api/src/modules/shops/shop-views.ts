import type { OwnerShopResponse } from "@chicman/shared";

import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";

export type Db = PrismaClient | Prisma.TransactionClient;

/** The shop columns that owners may see (allowlist). */
export const ownerShopSelect = {
  id: true,
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
} as const satisfies Prisma.ShopSelect;

/**
 * Builds the owner-facing shop view field by field (spec 06, Owner-facing
 * shop view). Internal reasons, internal notes, actors, and other audit
 * metadata are never selected, so they cannot leak into the response.
 */
export async function loadOwnerShopView(db: Db, shopId: string): Promise<OwnerShopResponse> {
  const shop = await db.shop.findUniqueOrThrow({ where: { id: shopId }, select: ownerShopSelect });

  const latestDecision = await db.shopStatusEvent.findFirst({
    where: { shopId, decisionType: { not: null } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { decisionType: true, createdAt: true },
  });

  // Only while REJECTED, and only the owner-facing reason.
  const rejection =
    shop.status === "REJECTED"
      ? await db.shopStatusEvent.findFirst({
          where: { shopId, decisionType: "APPLICATION_REJECTED" },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { applicantReason: true, createdAt: true },
        })
      : null;

  const changeRequest = await db.shopChangeRequest.findFirst({
    where: { shopId },
    orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
    select: { id: true, proposedShopName: true, proposedCity: true, status: true, submittedAt: true, decidedAt: true },
  });

  return {
    id: shop.id,
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
    latestDecision:
      latestDecision?.decisionType == null
        ? null
        : { type: latestDecision.decisionType, decidedAt: latestDecision.createdAt.toISOString() },
    rejection:
      rejection?.applicantReason == null
        ? null
        : { applicantReason: rejection.applicantReason, rejectedAt: rejection.createdAt.toISOString() },
    changeRequest:
      changeRequest === null
        ? null
        : {
            id: changeRequest.id,
            proposedShopName: changeRequest.proposedShopName,
            proposedCity: changeRequest.proposedCity,
            status: changeRequest.status,
            submittedAt: changeRequest.submittedAt.toISOString(),
            decidedAt: changeRequest.decidedAt?.toISOString() ?? null,
          },
  };
}
