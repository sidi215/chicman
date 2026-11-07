import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { createApp, type AppOptions } from "../../src/app.js";
import { JwksKeyStore, TokenVerifier } from "../../src/modules/auth/index.js";
import type { OwnedShop, ShopAccessRepository } from "../../src/modules/shops/shop-access.repository.js";
import type { AppUser, UserRepository } from "../../src/modules/users/user.repository.js";
import { AUDIENCE, ISSUER } from "./keys.js";

export interface KeyStoreTestOptions {
  timeoutMs?: number;
  cooldownMs?: number;
  maxAgeMs?: number;
  now?: () => number;
}

export function createTestKeyStore(jwksUrl: URL, options: KeyStoreTestOptions = {}): JwksKeyStore {
  return new JwksKeyStore({
    jwksUrl,
    timeoutMs: options.timeoutMs ?? 1000,
    cooldownMs: options.cooldownMs ?? 30_000,
    maxAgeMs: options.maxAgeMs ?? 600_000,
    ...(options.now ? { now: options.now } : {}),
  });
}

export function createTestVerifier(keyStore: JwksKeyStore): TokenVerifier {
  return new TokenVerifier({ keyStore, issuer: ISSUER, audience: AUDIENCE });
}

/** In-memory user repository that records which `sub` values were looked up. */
export class FakeUserRepository implements UserRepository {
  readonly lookups: string[] = [];
  readonly users = new Map<string, AppUser>();

  async findBySupabaseUserId(supabaseUserId: string): Promise<AppUser | null> {
    this.lookups.push(supabaseUserId);
    return this.users.get(supabaseUserId) ?? { id: `user-for-${supabaseUserId}`, roles: ["CUSTOMER"] };
  }
}

export class FakeShopRepository implements ShopAccessRepository {
  async findByOwnerUserId(): Promise<OwnedShop | null> {
    return null;
  }
}

export interface RunningApp {
  baseUrl: string;
  close(): Promise<void>;
}

export async function startApp(options: AppOptions): Promise<RunningApp> {
  const app = createApp(options);
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
