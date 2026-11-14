import type { AccountType } from "@chicman/shared";

import type { PrismaClient } from "../../lib/prisma.js";

/**
 * The application account, loaded from PostgreSQL for each request (AT-1).
 * `accountType` never comes from token claims, `user_metadata`, or the request.
 */
export interface AppUser {
  id: string;
  accountType: AccountType;
  /** An administrator whose administrative access was deactivated (Q7). */
  adminAccessDeactivated: boolean;
}

export interface UserRepository {
  /** Loads the account linked to the verified token `sub`, or `null` before account setup. */
  findBySupabaseUserId(supabaseUserId: string): Promise<AppUser | null>;
}

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findBySupabaseUserId(supabaseUserId: string): Promise<AppUser | null> {
    const user = await this.prisma.user.findUnique({
      where: { supabaseUserId },
      select: { id: true, accountType: true, adminAccessDeactivatedAt: true },
    });
    if (user === null) return null;
    return { id: user.id, accountType: user.accountType, adminAccessDeactivated: user.adminAccessDeactivatedAt !== null };
  }
}
