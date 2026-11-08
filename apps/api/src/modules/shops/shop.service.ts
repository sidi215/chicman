import {
  SHOP_ERROR_CODES,
  type OwnerShopResponse,
  type ShopChangeRequestCreateInput,
  type ShopCreateInput,
  type ShopField,
  type ShopStatus,
  type ShopUpdateInput,
} from "@chicman/shared";

import { Prisma } from "../../generated/prisma/client.js";
import { badRequest, HttpError, notFound } from "../../lib/http-error.js";
import type { PrismaClient } from "../../lib/prisma.js";
import type { AppUser } from "../users/user.repository.js";
import { assertShopOperationAllowed } from "./shop-policy.js";
import { loadOwnerShopView } from "./shop-views.js";

/** The owner's shop row, read under a row lock. */
export interface LockedShopRow {
  id: string;
  ownerUserId: string;
  status: ShopStatus;
  shopName: string;
  description: string;
  contactPhone: string;
  city: string;
  address: string;
  whatsappPhone: string | null;
  logoUrl: string | null;
}

/** Test-only fault injection points, used to prove rollback. */
export interface ShopServiceFaults {
  afterShopUpdated?: () => void | Promise<void>;
}

export const shopNotFound = (): HttpError => notFound(SHOP_ERROR_CODES.shopNotFound);
export const shopStatusConflict = (): HttpError => new HttpError(409, SHOP_ERROR_CODES.shopStatusConflict);

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Locks and returns the shop owned by the user (`FOR UPDATE`), or `null`. */
export async function lockShopByOwner(tx: Prisma.TransactionClient, ownerUserId: string): Promise<LockedShopRow | null> {
  const rows = await tx.$queryRaw<LockedShopRow[]>`
    SELECT "id", "ownerUserId", "status"::text AS "status", "shopName", "description", "contactPhone",
           "city", "address", "whatsappPhone", "logoUrl"
    FROM "Shop" WHERE "ownerUserId" = ${ownerUserId}::uuid FOR UPDATE`;
  return rows[0] ?? null;
}

/** Locks and returns a shop by ID (`FOR UPDATE`), or `null`. */
export async function lockShopById(tx: Prisma.TransactionClient, shopId: string): Promise<LockedShopRow | null> {
  const rows = await tx.$queryRaw<LockedShopRow[]>`
    SELECT "id", "ownerUserId", "status"::text AS "status", "shopName", "description", "contactPhone",
           "city", "address", "whatsappPhone", "logoUrl"
    FROM "Shop" WHERE "id" = ${shopId}::uuid FOR UPDATE`;
  return rows[0] ?? null;
}

/** Field values to write and their audit events, for the fields that actually change. */
export function diffFields(
  current: LockedShopRow,
  next: Partial<Record<ShopField, string | null | undefined>>,
): { field: ShopField; oldValue: string | null; newValue: string | null }[] {
  const changes: { field: ShopField; oldValue: string | null; newValue: string | null }[] = [];
  for (const [field, newValue] of Object.entries(next) as [ShopField, string | null | undefined][]) {
    if (newValue === undefined) continue;
    const oldValue = current[field];
    if (oldValue !== newValue) changes.push({ field, oldValue, newValue });
  }
  return changes;
}

/**
 * Owner shop operations (spec 06, rules 1–5 and 8). The shop is always
 * resolved from the authenticated user; the owner is always that user.
 */
export class ShopService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly faults: ShopServiceFaults = {},
  ) {}

  /** Rule 5: the owner's view in any status, or `404`. */
  async getOwnerView(userId: string): Promise<OwnerShopResponse> {
    const shop = await this.prisma.shop.findUnique({ where: { ownerUserId: userId }, select: { id: true } });
    if (shop === null) throw shopNotFound();
    return loadOwnerShopView(this.prisma, shop.id);
  }

  /**
   * Rule 1: creating the shop submits the initial application (`PENDING`).
   * The unique `ownerUserId` is the final guard: a second or concurrent
   * creation → `409`.
   */
  async create(userId: string, input: ShopCreateInput): Promise<OwnerShopResponse> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const shop = await tx.shop.create({
          data: {
            ownerUserId: userId,
            status: "PENDING",
            shopName: input.shopName,
            description: input.description,
            contactPhone: input.contactPhone,
            city: input.city,
            address: input.address,
            whatsappPhone: input.whatsappPhone ?? null,
          },
          select: { id: true },
        });
        await tx.shopStatusEvent.create({
          data: { shopId: shop.id, fromStatus: null, toStatus: "PENDING", actorUserId: userId },
        });
        return loadOwnerShopView(tx, shop.id);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new HttpError(409, SHOP_ERROR_CODES.shopAlreadyExists);
      throw error;
    }
  }

  /**
   * Rules 3, 4, and 8: update application fields. `PENDING`/`REJECTED`: all
   * fields. `APPROVED` (with `SELLER`): immediate fields only; `shopName` or
   * `city` → `400`. `SUSPENDED` → `403`. Status never changes. Each changed
   * field is audited in the same transaction.
   */
  async update(user: AppUser, input: ShopUpdateInput): Promise<OwnerShopResponse> {
    return this.prisma.$transaction(async (tx) => {
      const shop = await lockShopByOwner(tx, user.id);
      if (shop === null) throw shopNotFound();
      assertShopOperationAllowed("edit", shop.status, user.roles);
      if (shop.status === "APPROVED" && (input.shopName !== undefined || input.city !== undefined)) {
        throw badRequest(SHOP_ERROR_CODES.reviewFieldNotEditable);
      }

      const changes = diffFields(shop, {
        shopName: input.shopName,
        description: input.description,
        contactPhone: input.contactPhone,
        city: input.city,
        address: input.address,
        whatsappPhone: input.whatsappPhone,
        logoUrl: input.logoUrl,
      });

      if (changes.length > 0) {
        const data: Prisma.ShopUpdateManyMutationInput = {};
        for (const { field, newValue } of changes) {
          // Required fields are never null here (the schema refuses null).
          (data as Record<string, string | null>)[field] = newValue;
        }
        // Conditional on the status read under the lock.
        const updated = await tx.shop.updateMany({ where: { id: shop.id, status: shop.status }, data });
        if (updated.count !== 1) throw shopStatusConflict();
        await this.faults.afterShopUpdated?.();

        // Removing the logo releases its object for deletion by the cleanup job.
        if (changes.some((change) => change.field === "logoUrl")) {
          await tx.shopLogoObject.updateMany({
            where: { shopId: shop.id, status: "ACTIVE" },
            data: { status: "RELEASED", releasedAt: new Date() },
          });
        }

        await tx.shopFieldChangeEvent.createMany({
          data: changes.map((change) => ({
            shopId: shop.id,
            field: change.field,
            oldValue: change.oldValue,
            newValue: change.newValue,
            actorUserId: user.id,
            source: "OWNER_UPDATE" as const,
          })),
        });
      }
      return loadOwnerShopView(tx, shop.id);
    });
  }

  /** Rule 2: `REJECTED` → `PENDING` by the owner; any other status → `409`. Grants no role. */
  async resubmit(userId: string): Promise<OwnerShopResponse> {
    return this.prisma.$transaction(async (tx) => {
      const shop = await lockShopByOwner(tx, userId);
      if (shop === null) throw shopNotFound();
      const updated = await tx.shop.updateMany({ where: { id: shop.id, status: "REJECTED" }, data: { status: "PENDING" } });
      if (updated.count !== 1) throw shopStatusConflict();
      await tx.shopStatusEvent.create({
        data: { shopId: shop.id, fromStatus: "REJECTED", toStatus: "PENDING", actorUserId: userId },
      });
      return loadOwnerShopView(tx, shop.id);
    });
  }

  /**
   * Rule 8: propose `shopName`/`city` values for administrator re-review.
   * `Shop` is not modified. One open request per shop (partial unique index)
   * → `409` while one is open.
   */
  async submitChangeRequest(user: AppUser, input: ShopChangeRequestCreateInput): Promise<OwnerShopResponse> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const shop = await lockShopByOwner(tx, user.id);
        if (shop === null) throw shopNotFound();
        assertShopOperationAllowed("changeRequest", shop.status, user.roles);
        await tx.shopChangeRequest.create({
          data: {
            shopId: shop.id,
            proposedShopName: input.shopName ?? null,
            proposedCity: input.city ?? null,
            submittedByUserId: user.id,
          },
        });
        return loadOwnerShopView(tx, shop.id);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new HttpError(409, SHOP_ERROR_CODES.changeRequestOpen);
      throw error;
    }
  }
}
