import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, describe, it } from "node:test";

import { AuthenticationError, SupabaseEmailConfirmationChecker } from "../src/modules/auth/index.js";

describe("server-side email-confirmation check (spec 04)", () => {
  let server: Server;
  let baseUrl: string;
  let reply: { status: number; body: unknown; delayMs?: number } = { status: 200, body: {} };
  let seen: { url?: string; headers?: IncomingHttpHeaders } = {};

  before(async () => {
    server = createServer((req, res) => {
      seen = { ...(req.url === undefined ? {} : { url: req.url }), headers: req.headers };
      setTimeout(() => {
        res.writeHead(reply.status, { "content-type": "application/json" });
        res.end(JSON.stringify(reply.body));
      }, reply.delayMs ?? 0);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  beforeEach(() => {
    reply = { status: 200, body: {} };
    seen = {};
  });

  const checker = (timeoutMs = 500) =>
    new SupabaseEmailConfirmationChecker({ supabaseUrl: baseUrl, publishableKey: "sb_publishable_test", timeoutMs });
  const kindOf = async (promise: Promise<unknown>) => {
    try {
      await promise;
      return "resolved";
    } catch (error) {
      assert.ok(error instanceof AuthenticationError);
      return error.kind;
    }
  };

  it("reads the token owner's record with the publishable key and the user's token", async () => {
    const sub = randomUUID();
    reply = { status: 200, body: { id: sub, email_confirmed_at: "2026-11-05T10:00:00Z", user_metadata: {} } };
    assert.equal(await checker().isEmailConfirmed("user-token", sub), true);
    assert.equal(seen.url, "/auth/v1/user");
    assert.equal(seen.headers?.["apikey"], "sb_publishable_test");
    assert.equal(seen.headers?.["authorization"], "Bearer user-token");
  });

  it("an unconfirmed email → false, even if user_metadata claims otherwise", async () => {
    const sub = randomUUID();
    reply = { status: 200, body: { id: sub, email_confirmed_at: null, user_metadata: { email_verified: true } } };
    assert.equal(await checker().isEmailConfirmed("t", sub), false);
  });

  it("a record for another user → invalid", async () => {
    reply = { status: 200, body: { id: randomUUID(), email_confirmed_at: "2026-11-05T10:00:00Z" } };
    assert.equal(await kindOf(checker().isEmailConfirmed("t", randomUUID())), "invalid");
  });

  it("401/403 from Supabase → invalid; 5xx, timeouts, and refused connections → unavailable", async () => {
    reply = { status: 401, body: {} };
    assert.equal(await kindOf(checker().isEmailConfirmed("t", randomUUID())), "invalid");
    reply = { status: 403, body: {} };
    assert.equal(await kindOf(checker().isEmailConfirmed("t", randomUUID())), "invalid");
    reply = { status: 500, body: {} };
    assert.equal(await kindOf(checker().isEmailConfirmed("t", randomUUID())), "unavailable");
    reply = { status: 200, body: {}, delayMs: 300 };
    assert.equal(await kindOf(checker(50).isEmailConfirmed("t", randomUUID())), "unavailable");
    const refused = new SupabaseEmailConfirmationChecker({ supabaseUrl: "http://127.0.0.1:1", publishableKey: "k", timeoutMs: 500 });
    assert.equal(await kindOf(refused.isEmailConfirmed("t", randomUUID())), "unavailable");
  });
});
