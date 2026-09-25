/**
 * POST /api/auth/google
 * Body: { credential: "<Google ID token from Google Identity Services>" }
 *
 * Verifies the token against Google's JWKS, checks the email against the admin
 * roster, then creates a tracked session and sets a signed session cookie.
 * Same-origin only.
 *
 * Every outcome is audited, including the rejections: a burst of denied sign-ins
 * from one network is exactly what the audit trail exists to surface.
 */
import {
  SESSION_TTL_SECONDS,
  json,
  readJsonBody,
  resolveMember,
  sessionCookie,
  signSession,
  verifyGoogleIdToken
} from "../../_shared/auth.js";
import { createSession, touchMemberOnLogin } from "../../_shared/admins.js";
import { auditContext, recordAudit } from "../../_shared/audit.js";

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

  const context = await auditContext(request, env);

  let claims;
  try {
    claims = await verifyGoogleIdToken(credential, env.GOOGLE_CLIENT_ID);
  } catch (err) {
    const message = String(err?.message || "Could not verify Google sign-in.");
    await recordAudit(env, {
      actor: "unknown",
      action: "auth.login",
      status: "denied",
      entity: "session",
      summary: `Rejected Google token: ${message}`,
      details: { reason: message },
      context
    });
    return json({ error: message }, 401);
  }

  const email = String(claims.email).toLowerCase();
  const member = await resolveMember(env, email);
  if (!member) {
    await recordAudit(env, {
      actor: email,
      action: "auth.login",
      status: "denied",
      entity: "session",
      entityId: email,
      summary: "Sign-in denied: account is not on the admin roster",
      context
    });
    return json({ error: "This Google account is not an authorised admin." }, 403);
  }

  const now = Math.floor(Date.now() / 1000);
  const sid = crypto.randomUUID();
  const name = claims.name || null;
  const picture = claims.picture || null;

  try {
    await createSession(env, {
      id: sid,
      email,
      name,
      picture,
      role: member.role,
      userAgent: context.userAgent,
      device: context.device,
      browser: context.browser,
      os: context.os,
      ipHash: context.ipHash,
      country: context.country
    });
    await touchMemberOnLogin(env, email, { name, picture });
  } catch (err) {
    console.error("session bookkeeping failed:", err?.message || err);
    return json({ error: "Could not open a session. Try again." }, 500);
  }

  const token = await signSession(
    { sub: String(claims.sub || ""), email, sid, iat: now, exp: now + SESSION_TTL_SECONDS },
    env.AUTH_SECRET
  );

  await recordAudit(env, {
    actor: email,
    role: member.role,
    action: "auth.login",
    entity: "session",
    entityId: sid,
    summary: `Signed in as ${member.role}`,
    details: { method: "google", session: sid },
    context
  });

  return json(
    { ok: true, email, name, picture, role: member.role },
    200,
    { "Set-Cookie": sessionCookie(token) }
  );
}
