import { randomUUID } from "node:crypto";

import type { Role, ShopStatus } from "@chicman/shared";

import { MemoryRateLimiter, type RateLimiter } from "../../src/lib/rate-limiter.js";
import { createPrismaClient, type PrismaClient } from "../../src/lib/prisma.js";
import { AddressService, type AddressServiceFaults } from "../../src/modules/addresses/index.js";
import { AdminShopQueries } from "../../src/modules/admin/index.js";
import { CartService, type CartServiceFaults } from "../../src/modules/cart/index.js";
import { StockService } from "../../src/modules/inventory/index.js";
import { CatalogService, ProductImageService, ProductService, type ProductImageServiceFaults } from "../../src/modules/products/index.js";
import {
  LogoService,
  PrismaShopAccessRepository,
  ShopLifecycle,
  ShopService,
  type LogoServiceFaults,
  type ObjectStorage,
  type ShopLifecycleFaults,
  type ShopServiceFaults,
  type StagedObject,
} from "../../src/modules/shops/index.js";
import { PrismaUserRepository } from "../../src/modules/users/user.repository.js";
import { createTestKeyStore, createTestVerifier, startApp, type RunningApp } from "./app.js";
import { resetDatabase, TEST_SHOP_FIELDS } from "./database.js";
import { TestJwksServer } from "./jwks-server.js";
import { createTestKey, signToken, type TestKey } from "./keys.js";

export const MEDIA_BASE_URL = "https://media.test.chicman";
export const TEST_TIMING = { completionLeaseMs: 60_000, completionWindowMs: 900_000 };

/** In-memory S3 stand-in with failure injection. */
export class FakeObjectStorage implements ObjectStorage {
  readonly staging = new Map<string, Buffer>();
  readonly media = new Map<string, { body: Buffer; contentType: string }>();
  readonly presigned: { key: string; contentType: string; contentLength: number; expiresIn: number }[] = [];
  readonly mediaDeletes: string[] = [];
  failPutMedia = false;
  /** Write the object, then fail (a timeout after the write). */
  failPutMediaAfterWrite = false;
  failDeleteMedia = false;
  failDeleteStaging = false;
  failReadStaging = false;

  async presignStagingPut(key: string, contentType: string, contentLength: number, expiresIn: number): Promise<string> {
    this.presigned.push({ key, contentType, contentLength, expiresIn });
    return `https://staging.test/${key}?X-Amz-Expires=${expiresIn}&X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost`;
  }

  async readStaging(key: string, maxBytes: number): Promise<StagedObject> {
    if (this.failReadStaging) throw new Error("staging read failed");
    const body = this.staging.get(key);
    if (body === undefined) return { kind: "missing" };
    if (body.byteLength > maxBytes) return { kind: "tooLarge" };
    return { kind: "ok", bytes: Buffer.from(body) };
  }

  async putMedia(key: string, body: Buffer, contentType: string): Promise<void> {
    if (this.failPutMedia) throw new Error("media write failed");
    if (this.media.has(key)) throw new Error(`overwrite of ${key}`);
    this.media.set(key, { body: Buffer.from(body), contentType });
    if (this.failPutMediaAfterWrite) throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
  }

  async deleteMedia(key: string): Promise<void> {
    if (this.failDeleteMedia) throw new Error("media delete failed");
    this.mediaDeletes.push(key);
    this.media.delete(key);
  }

  async deleteStaging(key: string): Promise<void> {
    if (this.failDeleteStaging) throw new Error("staging delete failed");
    this.staging.delete(key);
  }
}

export interface Actor {
  sub: string;
  userId: string;
  token: string;
}

/** Mutable fault hooks; tests set and clear them. */
export interface HarnessFaults {
  shop: ShopServiceFaults;
  lifecycle: ShopLifecycleFaults;
  logo: LogoServiceFaults;
  address: AddressServiceFaults;
  productImage: ProductImageServiceFaults;
  cart: CartServiceFaults;
}

export const CATALOG_INTERNAL_KEY = "k".repeat(32);

export class ShopHarness {
  readonly jwks = new TestJwksServer();
  readonly storage = new FakeObjectStorage();
  readonly faults: HarnessFaults = { shop: {}, lifecycle: {}, logo: {}, address: {}, productImage: {}, cart: {} };
  prisma!: PrismaClient;
  app!: RunningApp;
  logos!: LogoService;
  private key!: TestKey;
  private productRateLimiter = new MemoryRateLimiter();
  /** Replaceable, so a test can exhaust the public catalog limit. */
  catalogRateLimiter: RateLimiter = new MemoryRateLimiter();
  /** Replaceable, so a test can exhaust the cart write limit. */
  cartRateLimiter: RateLimiter = new MemoryRateLimiter();

  constructor(private readonly databaseUrl: string) {}

  async start(): Promise<void> {
    this.prisma = createPrismaClient(this.databaseUrl);
    this.key = await createTestKey("ES256");
    await this.jwks.start();
    this.jwks.keys = [this.key.publicJwk];
    const shopAccess = new PrismaShopAccessRepository(this.prisma);
    this.logos = new LogoService({
      prisma: this.prisma,
      storage: this.storage,
      timing: TEST_TIMING,
      mediaPublicBaseUrl: MEDIA_BASE_URL,
      faults: this.faults.logo,
      log: () => undefined,
    });
    this.app = await startApp({
      corsOrigins: [],
      auth: {
        verifier: createTestVerifier(createTestKeyStore(this.jwks.url)),
        users: new PrismaUserRepository(this.prisma),
        shops: shopAccess,
      },
      addresses: { addresses: new AddressService(this.prisma, this.faults.address), rateLimiter: new MemoryRateLimiter() },
      shops: {
        shops: new ShopService(this.prisma, this.faults.shop),
        shopAccess,
        logos: this.logos,
        rateLimiter: new MemoryRateLimiter(),
      },
      admin: {
        lifecycle: new ShopLifecycle(this.prisma, this.faults.lifecycle),
        queries: new AdminShopQueries(this.prisma),
      },
      products: {
        products: new ProductService(this.prisma, MEDIA_BASE_URL),
        stock: new StockService(this.prisma, MEDIA_BASE_URL),
        images: new ProductImageService({
          prisma: this.prisma,
          storage: this.storage,
          timing: TEST_TIMING,
          mediaPublicBaseUrl: MEDIA_BASE_URL,
          faults: this.faults.productImage,
          log: () => undefined,
        }),
        // Fresh counters per test: every request comes from the same address.
        rateLimiter: { hit: (key, limit, windowMs) => this.productRateLimiter.hit(key, limit, windowMs) },
      },
      catalog: {
        catalog: new CatalogService(this.prisma, MEDIA_BASE_URL),
        rateLimiter: { hit: (key, limit, windowMs) => this.catalogRateLimiter.hit(key, limit, windowMs) },
        internalKey: CATALOG_INTERNAL_KEY,
      },
      cart: {
        cart: new CartService(this.prisma, MEDIA_BASE_URL, this.faults.cart),
        rateLimiter: { hit: (key, limit, windowMs) => this.cartRateLimiter.hit(key, limit, windowMs) },
      },
    });
  }

  async stop(): Promise<void> {
    await this.app.close();
    await this.jwks.stop();
    await this.prisma.$disconnect();
  }

  async reset(): Promise<void> {
    for (const group of Object.values(this.faults)) for (const key of Object.keys(group)) delete group[key];
    Object.assign(this.storage, {
      failPutMedia: false,
      failPutMediaAfterWrite: false,
      failDeleteMedia: false,
      failDeleteStaging: false,
      failReadStaging: false,
    });
    this.storage.staging.clear();
    this.storage.media.clear();
    this.storage.mediaDeletes.length = 0;
    this.storage.presigned.length = 0;
    this.productRateLimiter = new MemoryRateLimiter();
    this.catalogRateLimiter = new MemoryRateLimiter();
    this.cartRateLimiter = new MemoryRateLimiter();
    await resetDatabase(this.prisma);
  }

  /** A bootstrapped user (User + CustomerProfile) with the given roles. */
  async actor(roles: Role[] = ["CUSTOMER"], extraClaims: Record<string, unknown> = {}): Promise<Actor> {
    const sub = randomUUID();
    const user = await this.prisma.user.create({
      data: {
        supabaseUserId: sub,
        roles: { create: roles.map((role) => ({ role })) },
        customerProfile: { create: { phone: "+22222000000" } },
      },
    });
    return { sub, userId: user.id, token: await signToken(this.key, { sub, extraClaims }) };
  }

  /** The same user signing in again: a new token for the same identity. */
  async newSession(actor: Actor): Promise<Actor> {
    return { ...actor, token: await signToken(this.key, { sub: actor.sub, extraClaims: { session_id: randomUUID() } }) };
  }

  /** A shop inserted directly in a given status (with SELLER when approved or suspended). */
  async shopInStatus(status: ShopStatus, owner?: Actor): Promise<{ owner: Actor; shopId: string }> {
    const roles: Role[] = status === "APPROVED" || status === "SUSPENDED" ? ["CUSTOMER", "SELLER"] : ["CUSTOMER"];
    const actor = owner ?? (await this.actor(roles));
    const shop = await this.prisma.shop.create({ data: { ownerUserId: actor.userId, status, ...TEST_SHOP_FIELDS } });
    return { owner: actor, shopId: shop.id };
  }

  call(path: string, token: string | null, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
    return fetch(`${this.app.baseUrl}/api/v1${path}`, {
      method: init.method ?? "GET",
      headers: {
        ...(token === null ? {} : { authorization: `Bearer ${token}` }),
        "content-type": "application/json",
        ...init.headers,
      },
      ...(init.body === undefined ? {} : { body: typeof init.body === "string" ? init.body : JSON.stringify(init.body) }),
    });
  }
}
