/**
 * POST /api/auth/logout -> revokes the current session and clears the cookie.
 *
 * The row is marked revoked rather than deleted, so the audit trail keeps a
 * record of how the session ended.
 */
import { clearedSessionCookie, getSession, json } from "../../_shared/auth.js";
import { revokeSession } from "../../_shared/admins.js";
import { auditContext, recordAudit } from "../../_shared/audit.js";

export async function onRequestPost({ request, env }) {
  const session = await getSession(request, env);

  if (session) {
    const context = await auditContext(request, env);
    await revokeSession(env, session.sid);
    await recordAudit(env, {
      actor: session.email,
      role: session.role,
      action: "auth.logout",
      entity: "session",
      entityId: session.sid,
      summary: "Signed out",
      context
    });
  }

  return json({ ok: true }, 200, { "Set-Cookie": clearedSessionCookie() });
}
