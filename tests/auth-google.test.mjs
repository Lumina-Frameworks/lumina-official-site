/**
 * Tests for Google ID token verification.
 * Run: node tests/auth-google.test.mjs
 *
 * This is the security gate for the admin panel, so it gets adversarial cases,
 * not just the happy path. No Google account is needed: we generate our own RSA
 * keypair, serve it as the JWKS by stubbing fetch, and sign our own tokens.
 *
 * Note: googleJwks() memoises the key set for the life of the module, so the
 * first successful call fixes the cache. Tests are ordered around that.
 */
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

import { verifyGoogleIdToken } from "../functions/_shared/auth.js";

const CLIENT_ID = "1234-test.apps.googleusercontent.com";
const KID = "test-key-1";
const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

const encoder = new TextEncoder();
const b64url = (input) =>
  Buffer.from(input instanceof Uint8Array ? input : encoder.encode(input)).toString("base64url");

const realFetch = globalThis.fetch;

async function generateKeypair() {
  return crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256"
    },
    true,
    ["sign", "verify"]
  );
}

// Top-level await, not a before() hook: the keys must exist before any test
// body runs, and top-level hooks are not guaranteed to fire first.
const signingKey = await generateKeypair();
const attackerKey = await generateKeypair();

{
  const publicJwk = await crypto.subtle.exportKey("jwk", signingKey.publicKey);
  stubJwks([{ ...publicJwk, kid: KID, alg: "RS256", use: "sig" }]);
}

function claimsOf(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: "https://accounts.google.com",
    aud: CLIENT_ID,
    sub: "1234567890",
    email: "amirhafizi443@gmail.com",
    email_verified: true,
    iat: now - 30,
    exp: now + 3000,
    ...overrides
  };
}

async function signToken(claims, { key = signingKey.privateKey, kid = KID, alg = "RS256" } = {}) {
  const header = b64url(JSON.stringify({ alg, typ: "JWT", kid }));
  const payload = b64url(JSON.stringify(claims));
  const data = `${header}.${payload}`;
  if (alg === "none") return `${data}.`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(data));
  return `${data}.${b64url(new Uint8Array(signature))}`;
}

function stubJwks(keys) {
  globalThis.fetch = async (url) => {
    if (String(url) !== JWKS_URL) throw new Error("unexpected fetch: " + url);
    return {
      ok: true,
      status: 200,
      headers: new Headers({ "Cache-Control": "public, max-age=3600" }),
      json: async () => ({ keys })
    };
  };
}

describe("verifyGoogleIdToken", () => {
  test("accepts a correctly signed token with valid claims", async () => {
    const claims = await verifyGoogleIdToken(await signToken(claimsOf()), CLIENT_ID);
    assert.equal(claims.email, "amirhafizi443@gmail.com");
    assert.equal(claims.email_verified, true);
  });

  test("accepts the bare accounts.google.com issuer form", async () => {
    const token = await signToken(claimsOf({ iss: "accounts.google.com" }));
    await assert.doesNotReject(() => verifyGoogleIdToken(token, CLIENT_ID));
  });

  test("rejects a token issued for a different client id", async () => {
    const token = await signToken(claimsOf({ aud: "someone-elses-client-id" }));
    await assert.rejects(() => verifyGoogleIdToken(token, CLIENT_ID), /different client/);
  });

  test("rejects an unexpected issuer", async () => {
    const token = await signToken(claimsOf({ iss: "https://evil.example" }));
    await assert.rejects(() => verifyGoogleIdToken(token, CLIENT_ID), /issuer/);
  });

  test("rejects an expired token", async () => {
    const token = await signToken(claimsOf({ exp: Math.floor(Date.now() / 1000) - 3600 }));
    await assert.rejects(() => verifyGoogleIdToken(token, CLIENT_ID), /expired/);
  });

  test("rejects a token issued in the future", async () => {
    const token = await signToken(claimsOf({ iat: Math.floor(Date.now() / 1000) + 3600 }));
    await assert.rejects(() => verifyGoogleIdToken(token, CLIENT_ID), /future/);
  });

  test("rejects an unverified email", async () => {
    const token = await signToken(claimsOf({ email_verified: false }));
    await assert.rejects(() => verifyGoogleIdToken(token, CLIENT_ID), /not verified/);
  });

  test("rejects a token with no email claim", async () => {
    const claims = claimsOf();
    delete claims.email;
    const token = await signToken(claims);
    await assert.rejects(() => verifyGoogleIdToken(token, CLIENT_ID), /no email/);
  });

  test("rejects alg:none, the classic JWT downgrade", async () => {
    const token = await signToken(claimsOf(), { alg: "none" });
    await assert.rejects(() => verifyGoogleIdToken(token, CLIENT_ID), /Unsupported token algorithm/);
  });

  test("rejects an HS256 header even when the body looks right", async () => {
    const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT", kid: KID }));
    const payload = b64url(JSON.stringify(claimsOf()));
    await assert.rejects(
      () => verifyGoogleIdToken(`${header}.${payload}.${b64url("signature")}`, CLIENT_ID),
      /Unsupported token algorithm/
    );
  });

  test("rejects a token signed by an attacker key", async () => {
    const token = await signToken(claimsOf(), { key: attackerKey.privateKey });
    await assert.rejects(() => verifyGoogleIdToken(token, CLIENT_ID), /signature is not valid/);
  });

  test("rejects a tampered payload", async () => {
    const token = await signToken(claimsOf());
    const [header, , signature] = token.split(".");
    const forged = b64url(JSON.stringify(claimsOf({ email: "attacker@example.com" })));
    await assert.rejects(
      () => verifyGoogleIdToken(`${header}.${forged}.${signature}`, CLIENT_ID),
      /signature is not valid/
    );
  });

  test("rejects an unknown key id", async () => {
    const token = await signToken(claimsOf(), { kid: "not-a-real-kid" });
    await assert.rejects(() => verifyGoogleIdToken(token, CLIENT_ID), /No matching Google signing key/);
  });

  test("rejects malformed tokens without throwing a raw parse error", async () => {
    await assert.rejects(() => verifyGoogleIdToken("garbage", CLIENT_ID), /Malformed ID token/);
    await assert.rejects(() => verifyGoogleIdToken("", CLIENT_ID), /Malformed ID token/);
    await assert.rejects(() => verifyGoogleIdToken(null, CLIENT_ID), /Malformed ID token/);
  });

  test("refuses to verify when no client id is configured", async () => {
    const token = await signToken(claimsOf());
    await assert.rejects(() => verifyGoogleIdToken(token, ""), /GOOGLE_CLIENT_ID is not configured/);
  });

  test("reports a clear error when the key endpoint is unreachable", async () => {
    // A fresh module instance is the only way to clear the memoised key set.
    globalThis.fetch = async () => ({ ok: false, status: 503, headers: new Headers(), json: async () => ({}) });
    const { verifyGoogleIdToken: fresh } = await import("../functions/_shared/auth.js?v=2");
    const token = await signToken(claimsOf(), { kid: "some-other-kid" });
    await assert.rejects(
      () => fresh(token, CLIENT_ID),
      /Could not fetch Google signing keys \(503\)/
    );
    globalThis.fetch = realFetch;
  });
});
