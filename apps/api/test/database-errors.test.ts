import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "../src/generated/prisma/client.js";
import { databaseUnavailableReason, isDatabaseUnavailable } from "../src/lib/database-errors.js";

/** Same shape as Prisma 7 + @prisma/adapter-pg errors (observed 2026-11-06). */
const known = (code: string, cause?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError("message with postgresql://u:secret@host/db", {
    code,
    clientVersion: "7.10.1",
    ...(cause ? { meta: { modelName: "User", driverAdapterError: { name: "DriverAdapterError", cause } } } : {}),
  });

describe("database availability classification", () => {
  it("temporary availability failures → unavailable (503)", () => {
    const cases: [unknown, string][] = [
      [known("P1001", { kind: "DatabaseNotReachable" }), "P1001 DatabaseNotReachable"], // refused / unknown host
      [known("P1002"), "P1002"], // reached, timed out
      [known("P1008"), "P1008"], // operation timeout
      [known("P1017", { kind: "ConnectionClosed" }), "P1017 ConnectionClosed"], // server closed the connection
      [known("P2024"), "P2024"], // pool timeout
      [known("P2010", { kind: "postgres", originalCode: "57P01" }), "P2010 postgres 57P01"], // admin shutdown
      [known("P2010", { kind: "postgres", code: "53300" }), "P2010 postgres 53300"], // too many connections
      [known("P2010", { kind: "TooManyConnections" }), "P2010 TooManyConnections"],
      [new Prisma.PrismaClientInitializationError("init", "7.10.1", "P1001"), "P1001"],
    ];
    for (const [error, reason] of cases) {
      assert.equal(databaseUnavailableReason(error), reason);
      // The reason never carries the message, URL, or credentials.
      assert.ok(!reason.includes("secret") && !reason.includes("postgresql"));
    }
  });

  it("misconfiguration, query errors, and programming errors stay 500", () => {
    const cases: unknown[] = [
      known("P1000", { kind: "AuthenticationFailed" }), // wrong credentials
      known("P1003", { kind: "DatabaseDoesNotExist" }), // missing database
      known("P2002"), // unique violation
      known("P2010", { kind: "postgres", originalCode: "22012" }), // division by zero
      known("P2025"), // record not found
      new Prisma.PrismaClientInitializationError("init", "7.10.1", "P1000"),
      new Prisma.PrismaClientInitializationError("init", "7.10.1"),
      new TypeError("undefined is not a function"),
      Object.assign(new Error("ECONNREFUSED"), { code: "ECONNREFUSED" }), // not a database error
      "string",
      null,
    ];
    for (const error of cases) assert.equal(isDatabaseUnavailable(error), false, String(error));
  });
});
