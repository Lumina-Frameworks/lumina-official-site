/**
 * /api/admin/members/:email  (owner only)
 *   PUT    -> change role, suspend, reactivate, or add a note
 *   DELETE -> remove from the roster
 *
 * Guard rails, because this endpoint hands out access:
 * - environment-locked owners cannot be edited or removed from the console
 * - you cannot change your own role or remove yourself
 * - the last active owner cannot be demoted, suspended, or deleted
 * - any change to access revokes that person's live sessions immediately
 */
import { json, readJsonBody, requireRole } from "../../../_shared/auth.js";
import {
  ROLES,
  STATUSES,
  countOwners,
  isEnvOwner,
  normaliseEmail,
  removeMember,
  revokeSessionsFor,
  upsertMember
} from "../../../_shared/admins.js";
import { auditContext, recordAudit } from "../../../_shared/audit.js";

function targetEmailFrom(params) {
  // Pages hands route params back decoded, but a %40 that survives the trip
  // would silently create a second, unreachable roster row.
  try {
    return normaliseEmail(decodeURIComponent(String(params?.email || "")));
  } catch {
    return normaliseEmail(params?.email);
  }
}

function lockedResponse() {
  return json(
    {
      error:
        "This account is set in ADMIN_EMAILS and is always an owner. Change it in the Pages environment variables."
    },
    409
  );
}

export async function onRequestPut({ request, env, params }) {
  const guard = await requireRole(request, env, "owner");
  if (!guard.ok) return guard.response;

  const email = targetEmailFrom(params);
  if (!email) return json({ error: "An email is required." }, 400);
  if (isEnvOwner(env, email)) return lockedResponse();
  if (email === normaliseEmail(guard.session.email)) {
    return json({ error: "You cannot change your own role or access." }, 409);
  }

  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;

  const body = parsed.body && typeof parsed.body === "object" ? parsed.body : {};
  const role = body.role === undefined ? undefined : String(body.role).toLowerCase();
  const status = body.status === undefined ? undefined : String(body.status).toLowerCase();
  const note = body.note === undefined ? undefined : String(body.note).slice(0, 200);

  if (role !== undefined && !ROLES.includes(role)) {
    return json({ error: `Role must be one of: ${ROLES.join(", ")}.` }, 400);
  }
  if (status !== undefined && !STATUSES.includes(status)) {
    return json({ error: `Status must be one of: ${STATUSES.join(", ")}.` }, 400);
  }
  if (role === undefined && status === undefined && note === undefined) {
    return json({ error: "Nothing to change." }, 400);
  }

  const existing = await env.DB.prepare("SELECT email, role, status FROM admins WHERE email = ?")
    .bind(email)
    .first();
  if (!existing) {
    return json({ error: "That account is not in the roster." }, 404);
  }

  // Last owner protection: demoting or suspending the only remaining active
  // owner would leave the console unmanageable.
  const losesOwner =
    (role !== undefined && role !== "owner") || (status !== undefined && status !== "active");
  if (
    losesOwner &&
    existing.role === "owner" &&
    existing.status === "active" &&
    (await countOwners(env)) <= 1
  ) {
    return json({ error: "This is the last owner. Promote someone else first." }, 409);
  }

  const context = await auditContext(request, env);
  try {
    const member = await upsertMember(env, { email, role, status, note });
    // Any change to role or status invalidates the sessions that person holds,
    // so a demotion or suspension applies on their very next request.
    await revokeSessionsFor(env, email);

    const changes = [];
    if (role !== undefined) changes.push(`role -> ${role}`);
    if (status !== undefined) changes.push(`status -> ${status}`);
    if (note !== undefined) changes.push("note updated");

    await recordAudit(env, {
      actor: guard.session.email,
      role: guard.session.role,
      action: "admin.update",
      entity: "admin",
      entityId: email,
      summary: `Updated ${email}: ${changes.join(", ")}`,
      details: { role: member.role, status: member.status, note: note ?? null },
      context
    });

    return json({ ok: true, admin: member, sessionsRevoked: true });
  } catch (err) {
    await recordAudit(env, {
      actor: guard.session.email,
      role: guard.session.role,
      action: "admin.update",
      status: "failed",
      entity: "admin",
      entityId: email,
      summary: `Could not update ${email}`,
      details: { error: String(err?.message || err) },
      context
    });
    return json({ error: "Could not update the roster.", detail: String(err?.message || err) }, 500);
  }
}

export async function onRequestDelete({ request, env, params }) {
  const guard = await requireRole(request, env, "owner");
  if (!guard.ok) return guard.response;

  const email = targetEmailFrom(params);
  if (!email) return json({ error: "An email is required." }, 400);
  if (isEnvOwner(env, email)) return lockedResponse();
  if (email === normaliseEmail(guard.session.email)) {
    return json({ error: "You cannot remove your own access." }, 409);
  }

  const current = await env.DB.prepare("SELECT role, status FROM admins WHERE email = ?")
    .bind(email)
    .first();
  if (!current) return json({ error: "That account is not in the roster." }, 404);

  if (current.role === "owner" && current.status === "active" && (await countOwners(env)) <= 1) {
    return json({ error: "This is the last owner. Promote someone else first." }, 409);
  }

  const context = await auditContext(request, env);
  try {
    await removeMember(env, email);
    await revokeSessionsFor(env, email);
    await recordAudit(env, {
      actor: guard.session.email,
      role: guard.session.role,
      action: "admin.remove",
      entity: "admin",
      entityId: email,
      summary: `Removed ${email} from the roster`,
      details: { previousRole: current.role, previousStatus: current.status },
      context
    });
    return json({ ok: true, removed: email });
  } catch (err) {
    await recordAudit(env, {
      actor: guard.session.email,
      role: guard.session.role,
      action: "admin.remove",
      status: "failed",
      entity: "admin",
      entityId: email,
      summary: `Could not remove ${email}`,
      details: { error: String(err?.message || err) },
      context
    });
    return json({ error: "Could not remove the account.", detail: String(err?.message || err) }, 500);
  }
}
