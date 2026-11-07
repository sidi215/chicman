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
import { PrismaCustomerRepository } from "./modules/customers/index.js";
import { PrismaShopAccessRepository } from "./modules/shops/shop-access.repository.js";
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

const app = createApp({
  corsOrigins: config.corsOrigins,
  trustProxyHops: config.trustProxyHops,
  auth: {
    verifier: createTokenVerifier(config.supabase),
    users: new PrismaUserRepository(prisma),
    shops: new PrismaShopAccessRepository(prisma),
  },
  customers: {
    customers: new PrismaCustomerRepository(prisma),
    emailConfirmation: createEmailConfirmationChecker(config.supabase),
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
