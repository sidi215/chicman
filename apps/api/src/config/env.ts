import { existsSync, readFileSync } from "node:fs";

import dotenv from "dotenv";
import { z } from "zod";

const DEFAULT_PORT = 4000;

const requiredUrl = (name: string) =>
  z
    .string({ error: `${name} is required` })
    .trim()
    .min(1, `${name} is required`)
    .pipe(z.url({ protocol: /^https?$/, error: `${name} must be an http(s) URL` }));

const requiredString = (name: string) =>
  z.string({ error: `${name} is required` }).trim().min(1, `${name} is required`);

const optionalPositiveInt = (fallback: number) =>
  z
    .string()
    .trim()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value === "") return fallback;
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        ctx.addIssue({ code: "custom", message: `must be a positive integer, got "${value}"` });
        return z.NEVER;
      }
      return parsed;
    });

const envSchema = z.object({
  NODE_ENV: z.string().trim().optional().default("development"),
  PORT: z
    .string()
    .trim()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value === "") return DEFAULT_PORT;
      const port = Number(value);
      if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        ctx.addIssue({ code: "custom", message: `invalid port "${value}"` });
        return z.NEVER;
      }
      return port;
    }),
  CORS_ORIGINS: z
    .string()
    .optional()
    .transform((value) =>
      (value ?? "")
        .split(",")
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    ),
  // Must parse as a URL (special characters in the password percent-encoded).
  DATABASE_URL: requiredString("DATABASE_URL").refine(isPostgresUrl, {
    message: "DATABASE_URL must be a valid postgres:// or postgresql:// URL (percent-encode special characters in the password)",
  }),

  // Supabase Auth (feature 03). All required: the API refuses to start without them.
  SUPABASE_URL: requiredUrl("SUPABASE_URL"),
  SUPABASE_JWKS_URL: requiredUrl("SUPABASE_JWKS_URL"),
  SUPABASE_JWT_ISSUER: requiredString("SUPABASE_JWT_ISSUER"),
  SUPABASE_JWT_AUDIENCE: requiredString("SUPABASE_JWT_AUDIENCE"),
  // Publishable key, sent as `apikey` when the API reads the user's own Auth
  // record (email-confirmation check at bootstrap). Never the secret key.
  SUPABASE_PUBLISHABLE_KEY: requiredString("SUPABASE_PUBLISHABLE_KEY"),
  SUPABASE_AUTH_TIMEOUT_MS: optionalPositiveInt(3_000),

  // Redis (rate-limit counters). Required in production; without it, other
  // environments fall back to in-memory counters.
  REDIS_URL: z.string().trim().optional(),
  // Express `trust proxy` hop count, so `req.ip` is the client behind a proxy.
  TRUST_PROXY_HOPS: z
    .string()
    .trim()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value === "") return 0;
      const hops = Number(value);
      if (!Number.isInteger(hops) || hops < 0) {
        ctx.addIssue({ code: "custom", message: `must be a non-negative integer, got "${value}"` });
        return z.NEVER;
      }
      return hops;
    }),

  // JWKS retrieval hardening (optional, with defaults).
  SUPABASE_JWKS_TIMEOUT_MS: optionalPositiveInt(3_000),
  SUPABASE_JWKS_COOLDOWN_MS: optionalPositiveInt(30_000),
  SUPABASE_JWKS_MAX_AGE_MS: optionalPositiveInt(600_000),

  // S3-compatible object storage (spec 06, shop logos): SeaweedFS locally,
  // Cloudflare R2 in production. All or none outside production.
  S3_ENDPOINT: z.string().trim().optional(),
  S3_REGION: z.string().trim().optional(),
  S3_ACCESS_KEY_ID: z.string().trim().optional(),
  S3_SECRET_ACCESS_KEY: z.string().trim().optional(),
  S3_UPLOADS_BUCKET: z.string().trim().optional(),
  S3_MEDIA_BUCKET: z.string().trim().optional(),
  MEDIA_PUBLIC_BASE_URL: z.string().trim().optional(),
  // Logo completion timing (spec 06).
  LOGO_COMPLETION_LEASE_MS: optionalPositiveInt(60_000),
  LOGO_COMPLETION_WINDOW_MS: optionalPositiveInt(900_000),
});

/** Object storage keys; validated as a group (see `parseStorageConfig`). */
const STORAGE_KEYS = [
  "S3_ENDPOINT",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_UPLOADS_BUCKET",
  "S3_MEDIA_BUCKET",
  "MEDIA_PUBLIC_BASE_URL",
] as const;

const httpUrl = z.url({ protocol: /^https?$/ });

export interface AppConfig {
  nodeEnv: string;
  port: number;
  corsOrigins: string[];
  databaseUrl: string;
  /** `undefined`: in-memory rate-limit counters (not allowed in production). */
  redisUrl: string | undefined;
  trustProxyHops: number;
  supabase: {
    url: string;
    jwksUrl: URL;
    jwtIssuer: string;
    jwtAudience: string;
    jwksTimeoutMs: number;
    jwksCooldownMs: number;
    jwksMaxAgeMs: number;
    publishableKey: string;
    authTimeoutMs: number;
  };
  /** `undefined`: storage not configured (logo routes → `503`; not allowed in production). */
  storage: StorageConfig | undefined;
  logo: LogoTimingConfig;
}

export interface StorageConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Private staging bucket (presigned uploads; never publicly readable). */
  uploadsBucket: string;
  /** Public media bucket (verified logos only). */
  mediaBucket: string;
  /** Public origin of the media bucket, without a trailing slash. */
  mediaPublicBaseUrl: string;
}

export interface LogoTimingConfig {
  /** Completion lease; must exceed the worst-case verification and write time. */
  completionLeaseMs: number;
  /** Completion window, counted after the presigned URL expires. */
  completionWindowMs: number;
}

type ParsedEnv = z.output<typeof envSchema>;

/**
 * Storage settings are all required together. Without any of them, storage
 * is disabled (development and tests only). Returns error lines.
 */
function parseStorageConfig(env: ParsedEnv): { storage: StorageConfig | undefined; errors: string[] } {
  const present = STORAGE_KEYS.filter((key) => (env[key] ?? "") !== "");
  if (present.length === 0) {
    return { storage: undefined, errors: env.NODE_ENV === "production" ? ["  - S3_*: object storage is required in production"] : [] };
  }
  const errors = STORAGE_KEYS.filter((key) => (env[key] ?? "") === "").map((key) => `  - ${key}: is required when object storage is configured`);
  for (const key of ["S3_ENDPOINT", "MEDIA_PUBLIC_BASE_URL"] as const) {
    const value = env[key];
    if (value !== undefined && value !== "" && !httpUrl.safeParse(value).success) errors.push(`  - ${key}: must be an http(s) URL`);
  }
  if (errors.length > 0) return { storage: undefined, errors };
  return {
    errors,
    storage: {
      endpoint: env.S3_ENDPOINT ?? "",
      region: env.S3_REGION === undefined || env.S3_REGION === "" ? "auto" : env.S3_REGION,
      accessKeyId: env.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? "",
      uploadsBucket: env.S3_UPLOADS_BUCKET ?? "",
      mediaBucket: env.S3_MEDIA_BUCKET ?? "",
      mediaPublicBaseUrl: (env.MEDIA_PUBLIC_BASE_URL ?? "").replace(/\/+$/, ""),
    },
  };
}

function isPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "postgres:" || url.protocol === "postgresql:") && url.hostname.length > 0;
  } catch {
    return false;
  }
}

/** Keys defined more than once in a dotenv file (the last one silently wins). */
export function duplicateEnvKeys(contents: string): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const line of contents.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (!match?.[1]) continue;
    if (seen.has(match[1])) duplicates.add(match[1]);
    seen.add(match[1]);
  }
  return [...duplicates];
}

/**
 * Validates configuration from the given environment.
 * Throws an error listing every invalid or missing value.
 */
export function loadConfig(source: NodeJS.ProcessEnv): AppConfig {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid API configuration:\n${details}`);
  }
  const env = result.data;
  const redisUrl = env.REDIS_URL === undefined || env.REDIS_URL === "" ? undefined : env.REDIS_URL;
  if (env.NODE_ENV === "production" && redisUrl === undefined) {
    throw new Error("Invalid API configuration:\n  - REDIS_URL: is required in production");
  }
  const { storage, errors: storageErrors } = parseStorageConfig(env);
  if (storageErrors.length > 0) throw new Error(`Invalid API configuration:\n${storageErrors.join("\n")}`);
  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    corsOrigins: env.CORS_ORIGINS,
    databaseUrl: env.DATABASE_URL,
    redisUrl,
    trustProxyHops: env.TRUST_PROXY_HOPS,
    supabase: {
      url: env.SUPABASE_URL,
      jwksUrl: new URL(env.SUPABASE_JWKS_URL),
      jwtIssuer: env.SUPABASE_JWT_ISSUER,
      jwtAudience: env.SUPABASE_JWT_AUDIENCE,
      jwksTimeoutMs: env.SUPABASE_JWKS_TIMEOUT_MS,
      jwksCooldownMs: env.SUPABASE_JWKS_COOLDOWN_MS,
      jwksMaxAgeMs: env.SUPABASE_JWKS_MAX_AGE_MS,
      publishableKey: env.SUPABASE_PUBLISHABLE_KEY,
      authTimeoutMs: env.SUPABASE_AUTH_TIMEOUT_MS,
    },
    storage,
    logo: {
      completionLeaseMs: env.LOGO_COMPLETION_LEASE_MS,
      completionWindowMs: env.LOGO_COMPLETION_WINDOW_MS,
    },
  };
}

/** Storage and logo settings for the worker process (no Supabase settings needed). */
export function loadWorkerStorageConfig(source: NodeJS.ProcessEnv): { storage: StorageConfig | undefined; logo: LogoTimingConfig } {
  const env = envSchema
    .pick({
      NODE_ENV: true,
      S3_ENDPOINT: true,
      S3_REGION: true,
      S3_ACCESS_KEY_ID: true,
      S3_SECRET_ACCESS_KEY: true,
      S3_UPLOADS_BUCKET: true,
      S3_MEDIA_BUCKET: true,
      MEDIA_PUBLIC_BASE_URL: true,
      LOGO_COMPLETION_LEASE_MS: true,
      LOGO_COMPLETION_WINDOW_MS: true,
    })
    .safeParse(source);
  if (!env.success) throw new Error("Invalid worker configuration: storage or logo settings");
  const { storage, errors } = parseStorageConfig(env.data as ParsedEnv);
  if (errors.length > 0) throw new Error(`Invalid worker configuration:\n${errors.join("\n")}`);
  return {
    storage,
    logo: { completionLeaseMs: env.data.LOGO_COMPLETION_LEASE_MS, completionWindowMs: env.data.LOGO_COMPLETION_WINDOW_MS },
  };
}

/** Loads `.env` (if present) and validates the process environment. */
export function loadConfigFromProcess(): AppConfig {
  if (existsSync(".env")) {
    const duplicates = duplicateEnvKeys(readFileSync(".env", "utf8"));
    if (duplicates.length > 0) {
      console.warn(`.env defines these keys more than once (the last value wins): ${duplicates.join(", ")}`);
    }
  }
  dotenv.config({ quiet: true });
  return loadConfig(process.env);
}
