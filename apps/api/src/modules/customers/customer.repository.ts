import type { CustomerProfile, CustomerProfileResponse, Role } from "@chicman/shared";

import { Prisma } from "../../generated/prisma/client.js";
import { serviceUnavailable } from "../../lib/http-error.js";
import type { PrismaClient } from "../../lib/prisma.js";
import type { ProfileChanges } from "./customer.schemas.js";

export type CustomerAccount = CustomerProfileResponse;

export interface BootstrapResult {
  /** `true` when this call created the profile (→ `201`). */
  created: boolean;
  account: CustomerAccount;
}

export interface CustomerRepository {
  /** Creates or reuses the `User` and `CustomerProfile` (spec 04, Bootstrap). */
  bootstrap(supabaseUserId: string, phone: string): Promise<BootstrapResult>;
  /** The user's own profile, or `null` when none exists. */
  findByUserId(userId: string): Promise<CustomerAccount | null>;
  /** Applies validated changes to the user's own profile, or returns `null`. */
  update(userId: string, changes: ProfileChanges): Promise<CustomerAccount | null>;
}

/** Test-only fault injection points, used to prove transaction rollback. */
export interface RepositoryFaults {
  afterUserCreated?: () => void | Promise<void>;
  afterPhoneUpdated?: () => void | Promise<void>;
}

const BOOTSTRAP_ATTEMPTS = 3;

const profileSelect = {
  id: true,
  userId: true,
  fullName: true,
  preferredLocale: true,
  phone: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { roles: { select: { role: true }, orderBy: { role: "asc" } } } },
} as const satisfies Prisma.CustomerProfileSelect;

type ProfileRow = Prisma.CustomerProfileGetPayload<{ select: typeof profileSelect }>;

function toAccount(row: ProfileRow): CustomerAccount {
  const profile: CustomerProfile = {
    id: row.id,
    fullName: row.fullName,
    preferredLocale: row.preferredLocale,
    phone: row.phone,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
  return { userId: row.userId, roles: row.user.roles.map(({ role }) => role as Role), profile };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export class PrismaCustomerRepository implements CustomerRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly faults: RepositoryFaults = {},
  ) {}

  async bootstrap(supabaseUserId: string, phone: string): Promise<BootstrapResult> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.bootstrapOnce(supabaseUserId, phone);
      } catch (error) {
        // A concurrent request committed first. Retry and reuse its rows.
        if (!isUniqueViolation(error)) throw error;
        if (attempt >= BOOTSTRAP_ATTEMPTS) throw serviceUnavailable();
      }
    }
  }

  /** One transaction: both rows exist after commit, or neither was written. */
  private bootstrapOnce(supabaseUserId: string, phone: string): Promise<BootstrapResult> {
    return this.prisma.$transaction(async (tx) => {
      let user = await tx.user.findUnique({ where: { supabaseUserId }, select: { id: true } });
      if (user === null) {
        // A new User gets CUSTOMER. An existing User keeps its roles.
        user = await tx.user.create({
          data: { supabaseUserId, roles: { create: { role: "CUSTOMER" } } },
          select: { id: true },
        });
        await this.faults.afterUserCreated?.();
      }

      let created = false;
      const existing = await tx.customerProfile.findUnique({ where: { userId: user.id }, select: { id: true } });
      if (existing === null) {
        // Creates the profile (also repairs a User without one) and the
        // ACCOUNT_SETUP entry of the phone change history.
        await tx.customerProfile.create({
          data: {
            userId: user.id,
            phone,
            phoneChanges: {
              create: { actorUserId: user.id, changeType: "ACCOUNT_SETUP", previousPhone: null, newPhone: phone },
            },
          },
        });
        created = true;
      }

      const row = await tx.customerProfile.findUniqueOrThrow({ where: { userId: user.id }, select: profileSelect });
      return { created, account: toAccount(row) };
    });
  }

  async findByUserId(userId: string): Promise<CustomerAccount | null> {
    const row = await this.prisma.customerProfile.findUnique({ where: { userId }, select: profileSelect });
    return row === null ? null : toAccount(row);
  }

  async update(userId: string, changes: ProfileChanges): Promise<CustomerAccount | null> {
    return this.prisma.$transaction(async (tx) => {
      // Row lock: concurrent phone changes read the committed previous value,
      // so the history forms a consistent chain.
      const locked = await tx.$queryRaw<{ id: string; phone: string }[]>`
        SELECT "id", "phone" FROM "CustomerProfile" WHERE "userId" = ${userId}::uuid FOR UPDATE`;
      const current = locked[0];
      if (current === undefined) return null;

      const data: Prisma.CustomerProfileUpdateInput = {};
      if (changes.fullName !== undefined) data.fullName = changes.fullName;
      if (changes.preferredLocale !== undefined) data.preferredLocale = changes.preferredLocale;
      // No-op phone updates change nothing and write no history row.
      const newPhone = changes.phone !== undefined && changes.phone !== current.phone ? changes.phone : null;
      if (newPhone !== null) data.phone = newPhone;

      if (Object.keys(data).length > 0) {
        await tx.customerProfile.update({ where: { id: current.id }, data });
      }
      if (newPhone !== null) {
        await this.faults.afterPhoneUpdated?.();
        await tx.customerPhoneChange.create({
          data: {
            customerProfileId: current.id,
            actorUserId: userId,
            changeType: "CUSTOMER_UPDATE",
            previousPhone: current.phone,
            newPhone,
          },
        });
      }

      const row = await tx.customerProfile.findUniqueOrThrow({ where: { id: current.id }, select: profileSelect });
      return toAccount(row);
    });
  }
}
