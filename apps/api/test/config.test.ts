import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { duplicateEnvKeys, loadConfig } from "../src/config/env.js";

const base = {
  SUPABASE_URL: "https://ref.supabase.co",
  SUPABASE_JWKS_URL: "https://ref.supabase.co/auth/v1/.well-known/jwks.json",
  SUPABASE_JWT_ISSUER: "https://ref.supabase.co/auth/v1",
  SUPABASE_JWT_AUDIENCE: "authenticated",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
};

describe("API configuration", () => {
  it("accepts a valid PostgreSQL URL", () => {
    const config = loadConfig({ ...base, DATABASE_URL: "postgresql://u:p%3F%21@localhost:5442/chicman" });
    assert.equal(config.databaseUrl, "postgresql://u:p%3F%21@localhost:5442/chicman");
  });

  it("refuses a malformed DATABASE_URL without echoing it", () => {
    for (const value of ["postgresql://u:[p?!]@host:6543/db?x=1", "mysql://u:p@host/db", "not a url"]) {
      assert.throws(
        () => loadConfig({ ...base, DATABASE_URL: value }),
        (error: Error) => error.message.includes("DATABASE_URL must be a valid") && !error.message.includes("p?!"),
        value,
      );
    }
  });

  it("finds keys defined more than once in a .env file", () => {
    const file = "A=1\n# A=comment\nB=2\nexport A=3\nC=\nB=4\n";
    assert.deepEqual(duplicateEnvKeys(file).sort(), ["A", "B"]);
  });

  describe("object storage (spec 06)", () => {
    const db = { ...base, DATABASE_URL: "postgresql://u:p@localhost:5442/chicman", REDIS_URL: "redis://localhost:6379" };
    const storage = {
      S3_ENDPOINT: "http://localhost:8333",
      S3_ACCESS_KEY_ID: "key",
      S3_SECRET_ACCESS_KEY: "secret-value",
      S3_UPLOADS_BUCKET: "chicman-uploads",
      S3_MEDIA_BUCKET: "chicman-media",
      MEDIA_PUBLIC_BASE_URL: "http://localhost:8333/chicman-media/",
    };

    it("is disabled when no S3 variable is set, outside production", () => {
      const config = loadConfig(db);
      assert.equal(config.storage, undefined);
      assert.deepEqual(config.logo, { completionLeaseMs: 60_000, completionWindowMs: 900_000 });
    });

    it("is required in production", () => {
      assert.throws(() => loadConfig({ ...db, NODE_ENV: "production" }), /object storage is required in production/);
    });

    it("loads every setting together, with timing overrides", () => {
      const config = loadConfig({ ...db, ...storage, LOGO_COMPLETION_LEASE_MS: "30000", LOGO_COMPLETION_WINDOW_MS: "600000" });
      assert.equal(config.storage?.mediaPublicBaseUrl, "http://localhost:8333/chicman-media");
      assert.equal(config.storage?.region, "auto");
      assert.deepEqual(config.logo, { completionLeaseMs: 30_000, completionWindowMs: 600_000 });
    });

    it("refuses a partial configuration or invalid URLs, without echoing secrets", () => {
      const { S3_MEDIA_BUCKET: _omitted, ...partial } = storage;
      assert.throws(() => loadConfig({ ...db, ...partial }), /S3_MEDIA_BUCKET: is required/);
      assert.throws(
        () => loadConfig({ ...db, ...storage, MEDIA_PUBLIC_BASE_URL: "not a url" }),
        (error: Error) => error.message.includes("MEDIA_PUBLIC_BASE_URL: must be an http(s) URL") && !error.message.includes("secret-value"),
      );
      assert.throws(() => loadConfig({ ...db, ...storage, LOGO_COMPLETION_LEASE_MS: "-1" }));
    });
  });
});
