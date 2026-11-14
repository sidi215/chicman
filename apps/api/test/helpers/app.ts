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
    return this.users.get(supabaseUserId) ?? { id: `user-for-${supabaseUserId}`, accountType: "BUYER", adminAccessDeactivated: false };
  }
}

export class FakeShopRepository implements ShopAccessRepository {
  async findByOwnerUserId(): Promise<OwnedShop | null> {
    return null;
  }
}

export interface RunningApp {
  baseUrl: string;
  /** Every route the app serves, as `METHOD /api/v1/path` (Express router stack). */
  routes: string[];
  close(): Promise<void>;
}

interface StackLayer {
  route?: { path: string; methods: Record<string, boolean> };
  handle?: { stack?: StackLayer[] };
  matchers?: unknown[];
}

/** Lists the routes of an Express app: the `/api/v1` routers and their routes. */
function listRoutes(app: ReturnType<typeof createApp>): string[] {
  const routes: string[] = [];
  const walk = (stack: StackLayer[], prefix: string) => {
    for (const layer of stack) {
      if (layer.route !== undefined) {
        for (const method of Object.keys(layer.route.methods)) routes.push(`${method.toUpperCase()} ${prefix}${layer.route.path}`);
      } else if (layer.handle?.stack !== undefined) {
        walk(layer.handle.stack, "/api/v1");
      }
    }
  };
  walk((app as unknown as { router: { stack: StackLayer[] } }).router.stack, "");
  return [...new Set(routes)].sort();
}

export async function startApp(options: AppOptions): Promise<RunningApp> {
  const app = createApp(options);
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    routes: listRoutes(app),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
