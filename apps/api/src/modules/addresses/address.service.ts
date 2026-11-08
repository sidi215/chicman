import {
  ADDRESS_ERROR_CODES,
  isInServiceArea,
  MAX_ADDRESSES_PER_CUSTOMER,
  type AddressCreateInput,
  type AddressUpdateInput,
  type CustomerAddress,
  type CustomerAddressListResponse,
} from "@chicman/shared";

import { Prisma } from "../../generated/prisma/client.js";
import { badRequest, HttpError, notFound } from "../../lib/http-error.js";
import type { PrismaClient } from "../../lib/prisma.js";

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
  locationConfirmedAt: true,
  isDefault: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.CustomerAddressSelect;

type AddressRow = Prisma.CustomerAddressGetPayload<{ select: typeof addressSelect }>;

/** Owner response, field by field (allowlist; `userId` is never returned). */
function toAddress(row: AddressRow): CustomerAddress {
  return {
    id: row.id,
    label: row.label,
    city: row.city,
    district: row.district,
    landmark: row.landmark,
    deliveryPhone: row.deliveryPhone,
    latitude: row.latitude.toNumber(),
    longitude: row.longitude.toNumber(),
    locationSource: row.locationSource,
    accuracyMeters: row.accuracyMeters,
    locationConfirmedAt: row.locationConfirmedAt.toISOString(),
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const addressNotFound = (): HttpError => notFound(ADDRESS_ERROR_CODES.notFound);

function assertServiceArea(latitude: number, longitude: number): void {
  if (!isInServiceArea(latitude, longitude)) throw badRequest(ADDRESS_ERROR_CODES.outsideServiceArea);
}

/** Test-only fault injection, to prove rollback. */
export interface AddressServiceFaults {
  beforeCommit?: () => void | Promise<void>;
}

/**
 * Customer delivery addresses (spec 05). Every operation targets the
 * authenticated user's own addresses: lookups always include `userId`, so
 * another customer's address is `404`. Writes lock the user's row first, so
 * the address limit and the single default hold under concurrency.
 */
export class AddressService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly faults: AddressServiceFaults = {},
  ) {}

  /** Default first, then most recently updated. */
  async list(userId: string): Promise<CustomerAddressListResponse> {
    const rows = await this.prisma.customerAddress.findMany({
      where: { userId },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }, { id: "asc" }],
      select: addressSelect,
    });
    return { addresses: rows.map(toAddress) };
  }

  async get(userId: string, addressId: string): Promise<CustomerAddress> {
    const row = await this.prisma.customerAddress.findFirst({ where: { id: addressId, userId }, select: addressSelect });
    if (row === null) throw addressNotFound();
    return toAddress(row);
  }

  /** The first address becomes the default. */
  async create(userId: string, input: AddressCreateInput): Promise<CustomerAddress> {
    assertServiceArea(input.latitude, input.longitude);
    return this.prisma.$transaction(async (tx) => {
      await this.lockUser(tx, userId);
      const count = await tx.customerAddress.count({ where: { userId } });
      if (count >= MAX_ADDRESSES_PER_CUSTOMER) throw new HttpError(409, ADDRESS_ERROR_CODES.limitReached);
      const row = await tx.customerAddress.create({
        data: {
          userId,
          label: input.label ?? null,
          city: input.city,
          district: input.district,
          landmark: input.landmark,
          deliveryPhone: input.deliveryPhone ?? null,
          latitude: input.latitude,
          longitude: input.longitude,
          locationSource: input.locationSource,
          accuracyMeters: input.locationSource === "GPS" ? (input.accuracyMeters ?? null) : null,
          locationConfirmedAt: new Date(),
          isDefault: count === 0,
        },
        select: addressSelect,
      });
      await this.faults.beforeCommit?.();
      return toAddress(row);
    });
  }

  /**
   * Updates the given fields. A location change (latitude, longitude, and
   * source together) must be confirmed again; it refreshes
   * `locationConfirmedAt` and clears a stale accuracy.
   */
  async update(userId: string, addressId: string, input: AddressUpdateInput): Promise<CustomerAddress> {
    const moves = input.latitude !== undefined && input.longitude !== undefined && input.locationSource !== undefined;
    if (moves) {
      if (input.locationConfirmed !== true) throw badRequest(ADDRESS_ERROR_CODES.locationNotConfirmed);
      assertServiceArea(input.latitude ?? 0, input.longitude ?? 0);
    }
    return this.prisma.$transaction(async (tx) => {
      await this.lockUser(tx, userId);
      const current = await tx.customerAddress.findFirst({ where: { id: addressId, userId }, select: { locationSource: true } });
      if (current === null) throw addressNotFound();
      const data: Prisma.CustomerAddressUpdateInput = {};
      if (input.label !== undefined) data.label = input.label;
      if (input.city !== undefined) data.city = input.city;
      if (input.district !== undefined) data.district = input.district;
      if (input.landmark !== undefined) data.landmark = input.landmark;
      if (input.deliveryPhone !== undefined) data.deliveryPhone = input.deliveryPhone;
      if (moves) {
        data.latitude = input.latitude ?? 0;
        data.longitude = input.longitude ?? 0;
        data.locationSource = input.locationSource ?? "MANUAL";
        data.accuracyMeters = input.locationSource === "GPS" ? (input.accuracyMeters ?? null) : null;
        data.locationConfirmedAt = new Date();
      } else if (input.accuracyMeters !== undefined) {
        // Accuracy describes a device position: a manual pin never has one.
        data.accuracyMeters = current.locationSource === "GPS" ? input.accuracyMeters : null;
      }
      const row = await tx.customerAddress.update({ where: { id: addressId }, data, select: addressSelect });
      await this.faults.beforeCommit?.();
      return toAddress(row);
    });
  }

  /** Deleting the default promotes the most recently updated remaining address. */
  async delete(userId: string, addressId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.lockUser(tx, userId);
      const current = await tx.customerAddress.findFirst({ where: { id: addressId, userId }, select: { isDefault: true } });
      if (current === null) throw addressNotFound();
      await tx.customerAddress.delete({ where: { id: addressId } });
      if (current.isDefault) {
        const next = await tx.customerAddress.findFirst({
          where: { userId },
          orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
          select: { id: true },
        });
        if (next !== null) await this.flagDefault(tx, next.id, true);
      }
      await this.faults.beforeCommit?.();
    });
  }

  async setDefault(userId: string, addressId: string): Promise<CustomerAddress> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockUser(tx, userId);
      const current = await tx.customerAddress.findFirst({ where: { id: addressId, userId }, select: { id: true } });
      if (current === null) throw addressNotFound();
      // Clear first: the partial unique index allows one default at a time.
      await tx.$executeRaw`
        UPDATE "CustomerAddress" SET "isDefault" = false
        WHERE "userId" = ${userId}::uuid AND "isDefault" AND "id" <> ${addressId}::uuid`;
      await this.flagDefault(tx, addressId, true);
      const row = await tx.customerAddress.findUniqueOrThrow({ where: { id: addressId }, select: addressSelect });
      await this.faults.beforeCommit?.();
      return toAddress(row);
    });
  }

  /**
   * Changing which address is the default is not an edit of the address:
   * `updatedAt` (list order, promotion order) is left unchanged.
   */
  private async flagDefault(tx: Prisma.TransactionClient, addressId: string, isDefault: boolean): Promise<void> {
    await tx.$executeRaw`UPDATE "CustomerAddress" SET "isDefault" = ${isDefault} WHERE "id" = ${addressId}::uuid`;
  }

  /** Serializes a customer's address writes. */
  private async lockUser(tx: Prisma.TransactionClient, userId: string): Promise<void> {
    await tx.$queryRaw`SELECT 1 FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
  }
}
