/**
 * Auth for the Lumina admin panel.
 *
 * Flow: the browser obtains a Google ID token via Google Identity Services and
 * POSTs it to /api/auth/google. We verify it against Google's JWKS, check the
 * email against the ADMIN_EMAILS allowlist, then issue our own signed session
 * cookie. The Google token is never stored.
 *
 * Env:
 * - GOOGLE_CLIENT_ID (public, must match the token's aud claim)
 * - AUTH_SECRET     (secret, signs our session cookie)
 * - ADMIN_EMAILS    (comma-separated allowlist)
 */

export const SESSION_COOKIE = "lf_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);
const CLOCK_SKEW_SECONDS = 60;

/* ---------- base64url ---------- */

function b64urlEncode(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecodeToBytes(value) {
  const normalised = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalised + "=".repeat((4 - (normalised.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function b64urlDecodeToJson(value) {
  return JSON.parse(new TextDecoder().decode(b64urlDecodeToBytes(value)));
}

const encoder = new TextEncoder();

/* ---------- allowlist ---------- */

export function adminEmails(env) {
  return String(env.ADMIN_EMAILS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedAdmin(env, email) {
  const list = adminEmails(env);
  if (!list.length) return false;
  return list.includes(String(email || "").trim().toLowerCase());
}

/* ---------- session cookie ---------- */

async function hmacKey(secret, usages) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages
  );
}

export async function signSession(payload, secret) {
  const header = b64urlEncode(encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64urlEncode(encoder.encode(JSON.stringify(payload)));
  const data = `${header}.${body}`;
  const key = await hmacKey(secret, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return `${data}.${b64urlEncode(signature)}`;
}

export async function verifySession(token, secret) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;

  const [header, body, signature] = parts;
  let head;
  try {
    head = b64urlDecodeToJson(header);
  } catch {
    return null;
  }
  if (head?.alg !== "HS256") return null;

  const key = await hmacKey(secret, ["verify"]);
  const valid = await crypto.subtle
    .verify("HMAC", key, b64urlDecodeToBytes(signature), encoder.encode(`${header}.${body}`))
    .catch(() => false);
  if (!valid) return null;

  let claims;
  try {
    claims = b64urlDecodeToJson(body);
  } catch {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (!claims?.exp || claims.exp < now) return null;
  return claims;
}

export function sessionCookie(token, { maxAge = SESSION_TTL_SECONDS } = {}) {
  return [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${maxAge}`
  ].join("; ");
}

export function clearedSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function readCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) {
      return part.slice(index + 1).trim();
    }
  }
  return null;
}

/** @returns {Promise<{ email: string, sub: string } | null>} */
export async function getSession(request, env) {
  if (!env.AUTH_SECRET) return null;
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const claims = await verifySession(token, env.AUTH_SECRET);
  if (!claims?.email) return null;
  // Re-check the allowlist on every request, so removing someone takes effect
  // immediately instead of waiting out their 7-day cookie.
  if (!isAllowedAdmin(env, claims.email)) return null;
  return { email: String(claims.email), sub: String(claims.sub || "") };
}

/* ---------- Google ID token ---------- */

let jwksCache = { keys: null, expiresAt: 0 };

async function googleJwks() {
  const now = Date.now();
  if (jwksCache.keys && jwksCache.expiresAt > now) return jwksCache.keys;

  const response = await fetch(GOOGLE_JWKS_URL, { cf: { cacheTtl: 3600 } });
  if (!response.ok) throw new Error(`Could not fetch Google signing keys (${response.status}).`);

  const body = await response.json();
  if (!Array.isArray(body?.keys) || !body.keys.length) {
    throw new Error("Google signing keys response was empty.");
  }

  const maxAge = Number.parseInt(response.headers.get("Cache-Control")?.match(/max-age=(\d+)/)?.[1], 10);
  jwksCache = {
    keys: body.keys,
    expiresAt: now + (Number.isInteger(maxAge) ? maxAge * 1000 : 3600_000)
  };
  return body.keys;
}

/**
 * Verifies a Google ID token and returns its claims.
 * Throws on any failure.
 */
export async function verifyGoogleIdToken(idToken, clientId) {
  if (!clientId) throw new Error("GOOGLE_CLIENT_ID is not configured.");

  const parts = String(idToken || "").split(".");
  if (parts.length !== 3) throw new Error("Malformed ID token.");

  let header;
  try {
    header = b64urlDecodeToJson(parts[0]);
  } catch {
    throw new Error("Malformed ID token header.");
  }
  // RS256 only. Rejecting anything else blocks alg-substitution tricks.
  if (header?.alg !== "RS256") throw new Error("Unsupported token algorithm.");

  const keys = await googleJwks();
  const jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) throw new Error("No matching Google signing key for this token.");

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const valid = await crypto.subtle
    .verify(
      "RSASSA-PKCS1-v1_5",
      key,
      b64urlDecodeToBytes(parts[2]),
      encoder.encode(`${parts[0]}.${parts[1]}`)
    )
    .catch(() => false);
  if (!valid) throw new Error("ID token signature is not valid.");

  let claims;
  try {
    claims = b64urlDecodeToJson(parts[1]);
  } catch {
    throw new Error("Malformed ID token payload.");
  }

  const now = Math.floor(Date.now() / 1000);
  if (claims.aud !== clientId) throw new Error("ID token was issued for a different client.");
  if (!GOOGLE_ISSUERS.has(claims.iss)) throw new Error("Unexpected ID token issuer.");
  if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_SECONDS < now) {
    throw new Error("ID token has expired.");
  }
  if (typeof claims.iat === "number" && claims.iat - CLOCK_SKEW_SECONDS > now) {
    throw new Error("ID token issued in the future.");
  }
  if (claims.email_verified !== true) throw new Error("Google account email is not verified.");
  if (!claims.email) throw new Error("ID token has no email claim.");

  return claims;
}

/* ---------- helpers ---------- */

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders
    }
  });
}

/**
 * Guards admin routes. Rejects cross-site requests too, as defence in depth
 * behind the SameSite=Lax cookie.
 */
export async function requireAdmin(request, env) {
  const session = await getSession(request, env);
  if (!session) return { ok: false, response: json({ error: "Not authenticated." }, 401) };

  const origin = request.headers.get("Origin");
  if (origin) {
    const expected = new URL(request.url).origin;
    if (origin !== expected) {
      return { ok: false, response: json({ error: "Cross-origin request rejected." }, 403) };
    }
  }

  return { ok: true, session };
}

export async function readJsonBody(request) {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return { ok: false, response: json({ error: "Invalid JSON body." }, 400) };
  }
}
