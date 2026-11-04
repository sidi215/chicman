import dotenv from "dotenv";

dotenv.config({ quiet: true });

const DEFAULT_PORT = 4000;

function parsePort(value: string | undefined): number {
  if (value === undefined || value === "") {
    return DEFAULT_PORT;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT environment variable: "${value}"`);
  }

  return port;
}

function parseCorsOrigins(value: string | undefined): string[] {
  if (value === undefined || value.trim() === "") {
    return [];
  }

  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: parsePort(process.env.PORT),
  corsOrigins: parseCorsOrigins(process.env.CORS_ORIGINS),
} as const;
