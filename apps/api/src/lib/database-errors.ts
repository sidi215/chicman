import { Prisma } from "../generated/prisma/client.js";

/**
 * Temporary database availability failures (→ 503 SERVICE_UNAVAILABLE): the
 * database could not be reached, timed out, dropped the connection, or is out
 * of connections. Retrying later can succeed.
 *
 * Misconfiguration (wrong credentials `P1000`, missing database `P1003`),
 * query and constraint errors, and anything else stay 500: retrying does not
 * help, and they need a developer.
 */

/** Prisma error codes for an unreachable or overloaded database. */
const UNAVAILABLE_PRISMA_CODES = new Set([
  "P1001", // Can't reach database server
  "P1002", // Reached, but timed out
  "P1008", // Operations timed out
  "P1017", // Server closed the connection
  "P2024", // Timed out fetching a connection from the pool
]);

/** Driver-adapter error kinds with the same meaning. */
const UNAVAILABLE_ADAPTER_KINDS = new Set([
  "DatabaseNotReachable",
  "ConnectionClosed",
  "SocketTimeout",
  "TooManyConnections",
]);

/** PostgreSQL SQLSTATEs: connection exceptions, shutdown, too many connections. */
const UNAVAILABLE_SQLSTATES = new Set(["08000", "08001", "08003", "08006", "57P01", "57P02", "57P03", "53300"]);

interface AdapterCause {
  kind?: unknown;
  originalCode?: unknown;
  code?: unknown;
}

function adapterCause(error: Prisma.PrismaClientKnownRequestError): AdapterCause | undefined {
  const adapterError = (error.meta as { driverAdapterError?: { cause?: AdapterCause } } | undefined)?.driverAdapterError;
  return adapterError?.cause;
}

/** Short, credential-free description for logs, for example `P1001 DatabaseNotReachable`. */
export function databaseUnavailableReason(error: unknown): string | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const cause = adapterCause(error);
    const kind = typeof cause?.kind === "string" ? cause.kind : undefined;
    const sqlstate = [cause?.originalCode, cause?.code].find((value): value is string => typeof value === "string");
    if (
      UNAVAILABLE_PRISMA_CODES.has(error.code) ||
      (kind !== undefined && UNAVAILABLE_ADAPTER_KINDS.has(kind)) ||
      (sqlstate !== undefined && UNAVAILABLE_SQLSTATES.has(sqlstate))
    ) {
      return [error.code, kind, sqlstate].filter(Boolean).join(" ");
    }
    return null;
  }
  if (error instanceof Prisma.PrismaClientInitializationError && error.errorCode !== undefined) {
    return UNAVAILABLE_PRISMA_CODES.has(error.errorCode) ? error.errorCode : null;
  }
  return null;
}

export function isDatabaseUnavailable(error: unknown): boolean {
  return databaseUnavailableReason(error) !== null;
}
