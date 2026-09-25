/**
 * DELETE /api/admin/sessions/:id  (admin or owner)
 *
 * Revokes one live session. Signing yourself out this way is allowed and simply
 * ends this device's session.
 */
import { json, requireRole } from "../../../_shared/auth.js";
import { revokeSession } from "../../../_shared/admins.js";
import { auditContext, recordAudit } from "../../../_shared/audit.js";

export async function onRequestDelete({ request, env, params }) {
  const guard = await requireRole(request, env, "admin");
  if (!guard.ok) return guard.response;

  const id = String(params?.id || "").trim();
  if (!id) return json({ error: "A session id is required." }, 400);

  const context = await auditContext(request, env);
  const row = await env.DB.prepare("SELECT email, role, device, country FROM sessions WHERE id = ?")
    .bind(id)
    .first();
  if (!row) return json({ error: "That session no longer exists." }, 404);

  const isSelf = id === guard.session.sid;
  // An admin may end any session on a viewer's behalf, but not another admin's
  // or an owner's, so a compromised lower role cannot lock out the team.
  const rank = { viewer: 0, admin: 1, owner: 2 };
  if (!isSelf && (rank[row.role] ?? 0) >= rank[guard.session.role]) {
    await recordAudit(env, {
      actor: guard.session.email,
      role: guard.session.role,
      action: "session.revoke",
      status: "denied",
      entity: "session",
      entityId: id,
      summary: `Refused to revoke a ${row.role} session`,
      details: { target: row.email, targetRole: row.role },
      context
    });
    return json({ error: `You cannot revoke another ${row.role}'s session.` }, 403);
  }

  try {
    const revoked = await revokeSession(env, id);
    if (!revoked) return json({ error: "That session was already closed." }, 409);

    await recordAudit(env, {
      actor: guard.session.email,
      role: guard.session.role,
      action: "session.revoke",
      entity: "session",
      entityId: id,
      summary: isSelf
        ? "Signed out this device"
        : `Signed out ${row.email} on ${row.device || "an unknown device"}`,
      details: { target: row.email, device: row.device, country: row.country, self: isSelf },
      context
    });

    return json({ ok: true, revoked: id, self: isSelf });
  } catch (err) {
    return json({ error: "Could not revoke the session.", detail: String(err?.message || err) }, 500);
  }
}
