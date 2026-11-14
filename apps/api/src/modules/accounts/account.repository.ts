import {
  ACCOUNT_ERROR_CODES,
  REGISTRATION_INTENT_TTL_DAYS,
  SHOP_ERROR_CODES,
  type AccountProfile,
  type AccountProfileResponse,
  type AccountType,
  type RegistrableAccountType,
  type ShopCreateInput,
} from "@chicman/shared";

import { Prisma } from "../../generated/prisma/client.js";
import { HttpError, serviceUnavailable } from "../../lib/http-error.js";
import type { PrismaClient } from "../../lib/prisma.js";
import { insertShopApplication } from "../shops/shop.service.js";
import type { ProfileChanges } from "./account.schemas.js";

/** What account setup creates: the type comes from the registration intent, never from the request. */
export type SetupRequest = { accountType: "BUYER"; phone: string } | { accountType: "SELLER"; phone: string; shop: ShopCreateInput };

export interface SetupResult {
  /** `true` when this call created the account (→ `201`). */
  created: boolean;
  account: AccountProfileResponse;
}

export type IntentOutcome = "recorded" | "conflict";

export interface AccountRepository {
  /** Write-once registration intent (AT-1, section 5.3). Same value again → `recorded`. */
  recordIntent(supabaseUserId: string, accountType: RegistrableAccountType): Promise<IntentOutcome>;
  /** The intent's type, consumed or not, or `null`. */
  findIntent(supabaseUserId: string): Promise<RegistrableAccountType | null>;
  /** Creates the account of the intended type, or returns the existing one (AT-1, section 5). */
  setup(supabaseUserId: string, request: SetupRequest): Promise<SetupResult>;
  /** The account's own profile, or `null` when none exists. */
  findByUserId(userId: string): Promise<AccountProfileResponse | null>;
  /** Applies validated changes to the account's own profile, or returns `null`. */
  update(userId: string, changes: ProfileChanges): Promise<AccountProfileResponse | null>;
}

/** Test-only fault injection points, used to prove transaction rollback. */
export interface RepositoryFaults {
  afterUserCreated?: () => void | Promise<void>;
  afterPhoneUpdated?: () => void | Promise<void>;
}

const SETUP_ATTEMPTS = 3;

const profileSelect = {
  id: true,
  userId: true,
  fullName: true,
  preferredLocale: true,
  phone: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { accountType: true } },
} as const satisfies Prisma.CustomerProfileSelect;

type ProfileRow = Prisma.CustomerProfileGetPayload<{ select: typeof profileSelect }>;

function toAccount(row: ProfileRow): AccountProfileResponse {
  const profile: AccountProfile = {
    id: row.id,
    fullName: row.fullName,
    preferredLocale: row.preferredLocale,
    phone: row.phone,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
  return { userId: row.userId, accountType: row.user.accountType, profile };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

const accountTypeConflict = (): HttpError => new HttpError(409, ACCOUNT_ERROR_CODES.accountTypeConflict);

export class PrismaAccountRepository implements AccountRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly faults: RepositoryFaults = {},
  ) {}

  async recordIntent(supabaseUserId: string, accountType: RegistrableAccountType): Promise<IntentOutcome> {
    // INSERT … ON CONFLICT DO NOTHING keeps the first value; then compare.
    await this.prisma.registrationIntent.createMany({ data: [{ supabaseUserId, accountType }], skipDuplicates: true });
    const intent = await this.findIntent(supabaseUserId);
    return intent === accountType ? "recorded" : "conflict";
  }

  async findIntent(supabaseUserId: string): Promise<RegistrableAccountType | null> {
    const intent = await this.prisma.registrationIntent.findUnique({ where: { supabaseUserId }, select: { accountType: true } });
    return (intent?.accountType as RegistrableAccountType | undefined) ?? null;
  }

  async setup(supabaseUserId: string, request: SetupRequest): Promise<SetupResult> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.setupOnce(supabaseUserId, request);
      } catch (error) {
        // A concurrent setup committed first: retry and return its account.
        if (!isUniqueViolation(error)) throw error;
        if (attempt >= SETUP_ATTEMPTS) throw serviceUnavailable();
      }
    }
  }

  /**
   * One transaction: the account, its profile, the phone history entry, and
   * for a seller the `PENDING` shop with its submission record, and the
   * intent marked consumed. All of them or none.
   */
  private setupOnce(supabaseUserId: string, request: SetupRequest): Promise<SetupResult> {
    return this.prisma.$transaction(async (tx) => {
      // Serializes setups of one identity on its intent row.
      const [intent] = await tx.$queryRaw<{ accountType: AccountType }[]>`
        SELECT "accountType"::text AS "accountType" FROM "RegistrationIntent" WHERE "supabaseUserId" = ${supabaseUserId}::uuid FOR UPDATE`;
      if (intent === undefined || intent.accountType !== request.accountType) throw accountTypeConflict();

      const existing = await tx.user.findUnique({ where: { supabaseUserId }, select: { id: true, accountType: true } });
      if (existing !== null) {
        if (existing.accountType !== request.accountType) throw accountTypeConflict();
        const row = await tx.customerProfile.findUniqueOrThrow({ where: { userId: existing.id }, select: profileSelect });
        return { created: false, account: toAccount(row) };
      }

      const user = await tx.user.create({ data: { supabaseUserId, accountType: request.accountType }, select: { id: true } });
      await this.faults.afterUserCreated?.();
      await tx.customerProfile.create({
        data: {
          userId: user.id,
          phone: request.phone,
          phoneChanges: { create: { actorUserId: user.id, changeType: "ACCOUNT_SETUP", previousPhone: null, newPhone: request.phone } },
        },
      });
      if (request.accountType === "SELLER") {
        try {
          await insertShopApplication(tx, user.id, request.shop);
        } catch (error) {
          if (isUniqueViolation(error)) throw new HttpError(409, SHOP_ERROR_CODES.shopAlreadyExists);
          throw error;
        }
      }
      await tx.registrationIntent.update({ where: { supabaseUserId }, data: { consumedAt: new Date() } });

      const row = await tx.customerProfile.findUniqueOrThrow({ where: { userId: user.id }, select: profileSelect });
      return { created: true, account: toAccount(row) };
    });
  }

  async findByUserId(userId: string): Promise<AccountProfileResponse | null> {
    const row = await this.prisma.customerProfile.findUnique({ where: { userId }, select: profileSelect });
    return row === null ? null : toAccount(row);
  }

  async update(userId: string, changes: ProfileChanges): Promise<AccountProfileResponse | null> {
    return this.prisma.$transaction(async (tx) => {
      // Row lock: concurrent phone changes read the committed previous value,
      // so the history forms a consistent chain.
      const locked = await tx.$queryRaw<{ id: string; phone: string | null }[]>`
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

/**
 * Deletes registration intents never consumed within 30 days (AT-1, section
 * 5.3). A consumed intent is kept: it records which flow created the account.
 */
export async function purgeExpiredRegistrationIntents(prisma: PrismaClient, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - REGISTRATION_INTENT_TTL_DAYS * 24 * 60 * 60 * 1000);
  const { count } = await prisma.registrationIntent.deleteMany({ where: { consumedAt: null, createdAt: { lt: cutoff } } });
  return count;
}
