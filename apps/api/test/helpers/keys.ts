import { randomUUID } from "node:crypto";

import { exportJWK, generateKeyPair, SignJWT, type JWK, type JWTPayload } from "jose";

export const ISSUER = "https://test-project.supabase.co/auth/v1";
export const AUDIENCE = "authenticated";

export interface TestKey {
  kid: string;
  alg: "ES256" | "RS256";
  privateKey: CryptoKey;
  publicJwk: JWK;
}

export async function createTestKey(alg: "ES256" | "RS256" = "ES256", kid: string = randomUUID()): Promise<TestKey> {
  const { privateKey, publicKey } = await generateKeyPair(alg, { extractable: true });
  const publicJwk = { ...(await exportJWK(publicKey)), kid, alg, use: "sig" };
  return { kid, alg, privateKey, publicJwk };
}

export interface SignOptions {
  sub?: string | null;
  iss?: string;
  aud?: string | string[];
  /** Seconds relative to now. `null` omits the claim. */
  expIn?: number | null;
  nbfIn?: number;
  iatIn?: number;
  kid?: string;
  extraClaims?: JWTPayload;
}

/** Signs a Supabase-shaped access token with the test key. */
export async function signToken(key: TestKey, options: SignOptions = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: JWTPayload = {
    role: "authenticated",
    ...options.extraClaims,
    iss: options.iss ?? ISSUER,
    aud: options.aud ?? AUDIENCE,
    iat: now + (options.iatIn ?? 0),
  };
  const sub = options.sub === undefined ? randomUUID() : options.sub;
  if (sub !== null) payload.sub = sub;
  if (options.expIn !== null) payload.exp = now + (options.expIn ?? 3600);
  if (options.nbfIn !== undefined) payload.nbf = now + options.nbfIn;

  return new SignJWT(payload)
    .setProtectedHeader({ alg: key.alg, kid: options.kid ?? key.kid, typ: "JWT" })
    .sign(key.privateKey);
}

const base64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");

/** An unsigned `alg: none` token. */
export function unsignedToken(kid: string, sub = randomUUID()): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "none", kid, typ: "JWT" }));
  const payload = base64url(JSON.stringify({ sub, iss: ISSUER, aud: AUDIENCE, exp: now + 3600, iat: now }));
  return `${header}.${payload}.`;
}

/** Signs with HS256 using the given secret (for example the public key's JSON). */
export async function hs256Token(kid: string, secret: string, sub = randomUUID()): Promise<string> {
  return new SignJWT({ sub, iss: ISSUER, aud: AUDIENCE })
    .setProtectedHeader({ alg: "HS256", kid, typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(secret));
}

/** Replaces the payload of a signed token, keeping the original signature. */
export function tamperPayload(token: string, changes: JWTPayload): string {
  const [header, payload, signature] = token.split(".");
  const decoded = JSON.parse(Buffer.from(payload ?? "", "base64url").toString()) as JWTPayload;
  return `${header}.${base64url(JSON.stringify({ ...decoded, ...changes }))}.${signature}`;
}
