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
});
