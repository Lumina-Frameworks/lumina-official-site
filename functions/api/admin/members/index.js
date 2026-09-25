/**
 * /api/admin/members  (owner only)
 *   GET  -> the roster, the environment-locked owners, and roster counters
 *   POST -> grant access to an email
 */
import { json, readJsonBody, requireRole } from "../../../_shared/auth.js";
import {
  ROLES,
  isPlausibleEmail,
  listAdmins,
  listSessions,
  normaliseEmail,
  upsertMember
} from "../../../_shared/admins.js";
import { auditContext, recordAudit } from "../../../_shared/audit.js";

export async function onRequestGet({ request, env }) {
  const guard = await requireRole(request, env, "owner");
  if (!guard.ok) return guard.response;

  try {
    const admins = await listAdmins(env);
    const sessions = await listSessions(env, { limit: 200, activeOnly: true });

    // One sign-in row per person is noise; the audit tab has the detail.
    const lastLogin = new Map();
    const activeSessions = new Map();
    for (const session of sessions) {
      if (!lastLogin.has(session.email)) lastLogin.set(session.email, session.loginAt);
      activeSessions.set(session.email, (activeSessions.get(session.email) || 0) + 1);
    }

    const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 19).replace("T", " ");
    return json({
      admins: admins.map((admin) => ({
        ...admin,
        lastLogin: lastLogin.get(admin.email) || null,
        activeSessions: activeSessions.get(admin.email) || 0
      })),
      counts: {
        total: admins.length,
        owners: admins.filter((a) => a.role === "owner" && a.status === "active").length,
        admins: admins.filter((a) => a.role === "admin" && a.status === "active").length,
        viewers: admins.filter((a) => a.role === "viewer" && a.status === "active").length,
        suspended: admins.filter((a) => a.status === "suspended").length,
        activeSessions: sessions.length,
        signedInThisWeek: new Set(
          sessions.filter((s) => s.loginAt >= weekAgo).map((s) => s.email)
        ).size
      },
      viewer: { email: guard.session.email, role: guard.session.role }
    });
  } catch (err) {
    return json({ error: "Could not load the roster.", detail: String(err?.message || err) }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  const guard = await requireRole(request, env, "owner");
  if (!guard.ok) return guard.response;

  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;

  const email = normaliseEmail(parsed.body?.email);
  const role = String(parsed.body?.role || "admin").toLowerCase();
  const note = parsed.body?.note ? String(parsed.body.note).slice(0, 200) : null;

  if (!isPlausibleEmail(email)) return json({ error: "Enter a valid email address." }, 400);
  if (!ROLES.includes(role)) return json({ error: `Role must be one of: ${ROLES.join(", ")}.` }, 400);

  const context = await auditContext(request, env);
  const existing = await env.DB.prepare("SELECT email, role, status FROM admins WHERE email = ?")
    .bind(email)
    .first();

  // Re-granting a suspended account is fine; changing an owner's role from
  // here is not, because that path has no last-owner protection.
  if (existing?.role === "owner" && role !== "owner") {
    return json({ error: "Use the row's Manage action to change an owner's role." }, 409);
  }

  try {
    const member = await upsertMember(env, {
      email,
      role,
      status: "active",
      note,
      addedBy: guard.session.email
    });

    await recordAudit(env, {
      actor: guard.session.email,
      role: guard.session.role,
      action: existing ? "admin.update" : "admin.invite",
      entity: "admin",
      entityId: email,
      summary: existing
        ? `Re-granted access to ${email} as ${member.role}`
        : `Granted ${member.role} access to ${email}`,
      details: { role: member.role, note, previous: existing || null },
      context
    });

    return json({ ok: true, admin: member }, existing ? 200 : 201);
  } catch (err) {
    await recordAudit(env, {
      actor: guard.session.email,
      role: guard.session.role,
      action: "admin.invite",
      status: "failed",
      entity: "admin",
      entityId: email,
      summary: `Could not grant access to ${email}`,
      details: { error: String(err?.message || err) },
      context
    });
    return json({ error: "Could not grant access.", detail: String(err?.message || err) }, 500);
  }
}
