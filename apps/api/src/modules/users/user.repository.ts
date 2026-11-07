import type { Role } from "@chicman/shared";

import type { PrismaClient } from "../../lib/prisma.js";

/** Application user and roles, loaded from PostgreSQL for each request. */
export interface AppUser {
  id: string;
  roles: Role[];
}

export interface UserRepository {
  /** Loads the user linked to the verified token `sub`, or `null` before bootstrap. */
  findBySupabaseUserId(supabaseUserId: string): Promise<AppUser | null>;
}

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findBySupabaseUserId(supabaseUserId: string): Promise<AppUser | null> {
    const user = await this.prisma.user.findUnique({
      where: { supabaseUserId },
      select: { id: true, roles: { select: { role: true }, orderBy: { role: "asc" } } },
    });
    if (user === null) return null;
    return { id: user.id, roles: user.roles.map(({ role }) => role) };
  }
}
