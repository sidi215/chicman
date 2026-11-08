import { createApp } from "./app.js";
import { loadConfigFromProcess } from "./config/env.js";
import { createPrismaClient } from "./lib/prisma.js";
import {
  createRedisClient,
  FallbackRateLimiter,
  MemoryRateLimiter,
  RedisRateLimiter,
  type RateLimiter,
} from "./lib/rate-limiter.js";
import { createEmailConfirmationChecker, createTokenVerifier } from "./modules/auth/index.js";
import { AddressService } from "./modules/addresses/index.js";
import { AdminShopQueries } from "./modules/admin/index.js";
import { PrismaCustomerRepository } from "./modules/customers/index.js";
import { StockService } from "./modules/inventory/index.js";
import { ProductImageService, ProductService } from "./modules/products/index.js";
import {
  LogoService,
  PrismaShopAccessRepository,
  S3ObjectStorage,
  ShopLifecycle,
  ShopService,
} from "./modules/shops/index.js";
import { PrismaUserRepository } from "./modules/users/user.repository.js";

// Refuses to start if required configuration is missing or invalid.
const config = loadConfigFromProcess();
const prisma = createPrismaClient(config.databaseUrl);

const redis = config.redisUrl === undefined ? undefined : createRedisClient(config.redisUrl);
redis?.on("error", () => {
  // Reported by FallbackRateLimiter; avoid unhandled error events.
});
let rateLimiter: RateLimiter;
if (redis === undefined) {
  console.warn("REDIS_URL is not set: using in-memory rate-limit counters (development only).");
  rateLimiter = new MemoryRateLimiter();
} else {
  rateLimiter = new FallbackRateLimiter(new RedisRateLimiter(redis));
}

const shopAccess = new PrismaShopAccessRepository(prisma);
if (config.storage === undefined) {
  console.warn("Object storage (S3_*) is not configured: logo and product image uploads return 503 (development only).");
}
const objectStorage = config.storage === undefined ? undefined : new S3ObjectStorage(config.storage);
const mediaPublicBaseUrl = config.storage?.mediaPublicBaseUrl ?? "";
const logos =
  objectStorage === undefined
    ? undefined
    : new LogoService({ prisma, storage: objectStorage, timing: config.logo, mediaPublicBaseUrl });
const productImages =
  objectStorage === undefined
    ? undefined
    : new ProductImageService({ prisma, storage: objectStorage, timing: config.logo, mediaPublicBaseUrl });

const app = createApp({
  corsOrigins: config.corsOrigins,
  trustProxyHops: config.trustProxyHops,
  auth: {
    verifier: createTokenVerifier(config.supabase),
    users: new PrismaUserRepository(prisma),
    shops: shopAccess,
  },
  customers: {
    customers: new PrismaCustomerRepository(prisma),
    emailConfirmation: createEmailConfirmationChecker(config.supabase),
    rateLimiter,
  },
  addresses: { addresses: new AddressService(prisma), rateLimiter },
  shops: { shops: new ShopService(prisma), shopAccess, logos, rateLimiter },
  admin: { lifecycle: new ShopLifecycle(prisma), queries: new AdminShopQueries(prisma) },
  products: {
    products: new ProductService(prisma, mediaPublicBaseUrl),
    stock: new StockService(prisma, mediaPublicBaseUrl),
    images: productImages,
    rateLimiter,
  },
});

const server = app.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port} (${config.nodeEnv})`);
});

const shutdown = () => {
  server.close(() => {
    redis?.disconnect();
    void prisma.$disconnect().finally(() => process.exit(0));
  });
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
