/**
 * POST /api/auth/google
 * Body: { credential: "<Google ID token from Google Identity Services>" }
 *
 * Verifies the token against Google's JWKS, checks the email against
 * ADMIN_EMAILS, and sets a signed session cookie. Same-origin only.
 */
import {
  SESSION_TTL_SECONDS,
  isAllowedAdmin,
  json,
  readJsonBody,
  sessionCookie,
  signSession,
  verifyGoogleIdToken
} from "../../_shared/auth.js";

export async function onRequestPost({ request, env }) {
  if (!env.AUTH_SECRET) {
    return json({ error: "Auth is not configured. Missing AUTH_SECRET." }, 500);
  }
  if (!env.GOOGLE_CLIENT_ID) {
    return json({ error: "Auth is not configured. Missing GOOGLE_CLIENT_ID." }, 500);
  }

  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;

  const credential = parsed.body?.credential;
  if (typeof credential !== "string" || !credential.trim()) {
    return json({ error: "Missing Google credential." }, 400);
  }

  let claims;
  try {
    claims = await verifyGoogleIdToken(credential, env.GOOGLE_CLIENT_ID);
  } catch (err) {
    return json({ error: String(err?.message || "Could not verify Google sign-in.") }, 401);
  }

  if (!isAllowedAdmin(env, claims.email)) {
    return json({ error: "This Google account is not an authorised admin." }, 403);
  }

  const now = Math.floor(Date.now() / 1000);
  const email = String(claims.email).toLowerCase();
  const token = await signSession(
    { sub: String(claims.sub || ""), email, iat: now, exp: now + SESSION_TTL_SECONDS },
    env.AUTH_SECRET
  );

  return json(
    { ok: true, email, name: claims.name || null, picture: claims.picture || null },
    200,
    { "Set-Cookie": sessionCookie(token) }
  );
}
