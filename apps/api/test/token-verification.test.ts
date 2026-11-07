import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { after, before, describe, it } from "node:test";

import { FakeShopRepository, FakeUserRepository, createTestKeyStore, createTestVerifier, startApp, type RunningApp } from "./helpers/app.js";
import { TestJwksServer } from "./helpers/jwks-server.js";
import { createTestKey, hs256Token, signToken, tamperPayload, unsignedToken, type TestKey } from "./helpers/keys.js";

describe("access-token verification (spec 03)", () => {
  const jwks = new TestJwksServer();
  const users = new FakeUserRepository();
  let app: RunningApp;
  let key: TestKey;
  let rsaKey: TestKey;
  let otherKey: TestKey;

  before(async () => {
    key = await createTestKey("ES256");
    rsaKey = await createTestKey("RS256");
    otherKey = await createTestKey("ES256", key.kid); // same kid, different key pair
    await jwks.start();
    jwks.keys = [key.publicJwk, rsaKey.publicJwk];
    const verifier = createTestVerifier(createTestKeyStore(jwks.url));
    app = await startApp({ corsOrigins: [], auth: { verifier, users, shops: new FakeShopRepository() } });
  });

  after(async () => {
    await app.close();
    await jwks.stop();
  });

  const session = (headers: Record<string, string> = {}) =>
    fetch(`${app.baseUrl}/api/v1/auth/session`, { headers });

  const expect401 = async (response: Response) => {
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: { code: "UNAUTHORIZED" } });
  };

  it("accepts a valid ES256 token, and the identity is the verified sub", async () => {
    const sub = randomUUID();
    const response = await session({ authorization: `Bearer ${await signToken(key, { sub })}` });
    assert.equal(response.status, 200);
    assert.equal(users.lookups.at(-1), sub);
    assert.deepEqual(await response.json(), { userId: `user-for-${sub}`, roles: ["CUSTOMER"] });
  });

  it("accepts a valid RS256 token", async () => {
    const response = await session({ authorization: `Bearer ${await signToken(rsaKey)}` });
    assert.equal(response.status, 200);
  });

  it("accepts a lowercase bearer scheme", async () => {
    const response = await session({ authorization: `bearer ${await signToken(key)}` });
    assert.equal(response.status, 200);
  });

  it("rejects a token signed with the wrong key → 401", async () => {
    await expect401(await session({ authorization: `Bearer ${await signToken(otherKey)}` }));
  });

  it("rejects a tampered payload → 401", async () => {
    const token = tamperPayload(await signToken(key), { sub: randomUUID() });
    await expect401(await session({ authorization: `Bearer ${token}` }));
  });

  it("rejects alg: none → 401", async () => {
    await expect401(await session({ authorization: `Bearer ${unsignedToken(key.kid)}` }));
  });

  it("rejects HS256 tokens (including one keyed with the public JWK) → 401", async () => {
    const secret = JSON.stringify(key.publicJwk);
    await expect401(await session({ authorization: `Bearer ${await hs256Token(key.kid, secret)}` }));
  });

  it("rejects a token whose header alg does not match the key's algorithm → 401", async () => {
    // RS256 key published under the ES256 key's kid would be needed to confuse;
    // here an ES256 token claims the RSA key's kid.
    const token = await signToken(key, { kid: rsaKey.kid });
    await expect401(await session({ authorization: `Bearer ${token}` }));
  });

  it("rejects the wrong issuer → 401", async () => {
    await expect401(await session({ authorization: `Bearer ${await signToken(key, { iss: "https://evil.supabase.co/auth/v1" })}` }));
  });

  it("rejects the wrong audience → 401", async () => {
    await expect401(await session({ authorization: `Bearer ${await signToken(key, { aud: "anon" })}` }));
  });

  it("accepts an audience array that contains the expected audience", async () => {
    const response = await session({ authorization: `Bearer ${await signToken(key, { aud: ["other", "authenticated"] })}` });
    assert.equal(response.status, 200);
  });

  it("rejects an expired token beyond the 30 s tolerance → 401", async () => {
    await expect401(await session({ authorization: `Bearer ${await signToken(key, { expIn: -31 })}` }));
  });

  it("accepts a token expired within the tolerance", async () => {
    const response = await session({ authorization: `Bearer ${await signToken(key, { expIn: -10 })}` });
    assert.equal(response.status, 200);
  });

  it("rejects a token without exp → 401", async () => {
    await expect401(await session({ authorization: `Bearer ${await signToken(key, { expIn: null })}` }));
  });

  it("rejects nbf or iat in the future beyond tolerance → 401", async () => {
    await expect401(await session({ authorization: `Bearer ${await signToken(key, { nbfIn: 120 })}` }));
    await expect401(await session({ authorization: `Bearer ${await signToken(key, { iatIn: 120 })}` }));
  });

  it("rejects a missing sub, or a sub that is not a UUID → 401", async () => {
    await expect401(await session({ authorization: `Bearer ${await signToken(key, { sub: null })}` }));
    await expect401(await session({ authorization: `Bearer ${await signToken(key, { sub: "not-a-uuid" })}` }));
  });

  it("rejects a token without kid → 401", async () => {
    const token = await signToken(key);
    const [, payload, signature] = token.split(".");
    const header = Buffer.from(JSON.stringify({ alg: "ES256", typ: "JWT" })).toString("base64url");
    await expect401(await session({ authorization: `Bearer ${header}.${payload}.${signature}` }));
  });

  it("rejects a missing or malformed Authorization header → 401", async () => {
    const token = await signToken(key);
    await expect401(await session());
    await expect401(await session({ authorization: token }));
    await expect401(await session({ authorization: `Basic ${token}` }));
    await expect401(await session({ authorization: `Bearer ${token} extra` }));
    await expect401(await session({ authorization: "Bearer " }));
    await expect401(await session({ authorization: "Bearer not.a.jwt!" }));
    await expect401(await session({ authorization: "Bearer garbage" }));
  });

  it("ignores tokens in the query string, cookies, and body → 401", async () => {
    const token = await signToken(key);
    await expect401(await fetch(`${app.baseUrl}/api/v1/auth/session?access_token=${token}&token=${token}`));
    await expect401(await session({ cookie: `sb-access-token=${token}; access_token=${token}` }));
    await expect401(
      await fetch(`${app.baseUrl}/api/v1/auth/session`, {
        method: "GET",
        headers: { "content-type": "application/json", "x-access-token": token },
      }),
    );
  });

  it("rejects two Authorization headers → 401", async () => {
    const token = await signToken(key);
    const url = new URL(`${app.baseUrl}/api/v1/auth/session`);
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        { host: url.hostname, port: url.port, path: url.pathname, method: "GET", headers: ["host", url.host, "authorization", `Bearer ${token}`, "authorization", `Bearer ${token}`] },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end();
    });
    assert.equal(status, 401);
  });
});
