/**
 * Admin roster: who is allowed into the console, and as what.
 *
 * Two layers, deliberately:
 * - `ADMIN_EMAILS` in the environment is the bootstrap and break-glass list.
 *   Those addresses are always owners and can never be demoted or removed from
 *   the console, so a mistake in the roster cannot lock everyone out.
 * - The `admins` table is the working roster, editable from the console.
 *
 * Roles (ascending):
 *   viewer  read-only: sees projects, the roster, and the audit trail
 *   admin   manages projects and revokes sessions
 *   owner   additionally invites, re-roles, suspends, and removes admins
 */
import { adminEmails } from "./emails.js";

export const ROLES = ["owner", "admin", "viewer"];
const ROLE_RANK = { viewer: 0, admin: 1, owner: 2 };
const STATUSES = ["active", "suspended"];

const COLUMNS =
  "email, name, picture, role, status, note, added_by, created_at, updated_at, last_seen, login_count";

export function roleRank(role) {
  return Object.prototype.hasOwnProperty.call(ROLE_RANK, role) ? ROLE_RANK[role] : -1;
}

export function can(member, required) {
  return roleRank(member?.role) >= roleRank(required);
}

export function isEnvOwner(env, email) {
  return adminEmails(env).includes(String(email || "").trim().toLowerCase());
}

export function normaliseEmail(value) {
  return String(value || "").trim().toLowerCase();
}

/** Deliberately permissive; the authority on deliverability is Google, not us. */
export function isPlausibleEmail(value) {
  const email = normaliseEmail(value);
  return email.length <= 254 && /^[^\s@,]+@[^\s@,]+\.[a-z]{2,}$/i.test(email);
}

export function shapeAdmin(row) {
  return {
    email: row.email,
    name: row.name || null,
    picture: row.picture || null,
    role: row.role,
    status: row.status,
    note: row.note || null,
    addedBy: row.added_by || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    lastSeen: row.last_seen || null,
    loginCount: Number(row.login_count || 0),
    // Environment entries are rendered as locked in the console.
    locked: row.locked === 1 || row.locked === true
  };
}

export function shapeSession(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name || null,
    picture: row.picture || null,
    role: row.role,
    loginAt: row.login_at,
    lastSeen: row.last_seen,
    status: row.status,
    device: row.device || null,
    browser: row.browser || null,
    os: row.os || null,
    ipHash: row.ip_hash || null,
    country: row.country || null,
    current: Boolean(row.current)
  };
}

/* ---------- reads ---------- */

export async function getMember(env, email) {
  if (!env?.DB) return null;
  const row = await env.DB.prepare(`SELECT ${COLUMNS} FROM admins WHERE email = ?`)
    .bind(normaliseEmail(email))
    .first();
  if (row) return shapeAdmin(row);
  // Environment owners that have never signed in still have no row.
  if (isEnvOwner(env, email)) {
    return {
      email: normaliseEmail(email),
      name: null,
      picture: null,
      role: "owner",
      status: "active",
      note: null,
      addedBy: null,
      createdAt: null,
      updatedAt: null,
      lastSeen: null,
      loginCount: 0,
      locked: true
    };
  }
  return null;
}

export async function listAdmins(env) {
  const { results } = await env.DB.prepare(`SELECT ${COLUMNS} FROM admins`).all();
  const envOrder = new Map(adminEmails(env).map((email, index) => [email, index]));

  const roster = (results || []).map(shapeAdmin);
  const seen = new Set(roster.map((entry) => entry.email));

  // Environment owners that have never been written to the table still belong
  // in the list: they are the top of the hierarchy by definition.
  const locked = adminEmails(env)
    .filter((email) => !seen.has(email))
    .map((email) => ({
      email,
      name: null,
      picture: null,
      role: "owner",
      status: "active",
      note: "Set in ADMIN_EMAILS",
      addedBy: null,
      createdAt: null,
      updatedAt: null,
      lastSeen: null,
      loginCount: 0,
      locked: true
    }));

  const all = [...locked, ...roster.map((entry) => ({ ...entry, locked: isEnvOwner(env, entry.email) }))];

  // Rank: locked owners first in their configured order, then everyone else by
  // role, then email. Sorting here rather than in SQL keeps the two sources in
  // one deterministic order.
  return all.sort((a, b) => {
    const aEnv = envOrder.has(a.email) ? envOrder.get(a.email) : Number.MAX_SAFE_INTEGER;
    const bEnv = envOrder.has(b.email) ? envOrder.get(b.email) : Number.MAX_SAFE_INTEGER;
    if (aEnv !== bEnv) return aEnv - bEnv;
    const rank = roleRank(b.role) - roleRank(a.role);
    if (rank !== 0) return rank;
    return a.email.localeCompare(b.email);
  });
}

export async function countOwners(env) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM admins WHERE role = 'owner' AND status = 'active'"
  ).first();
  return Number(row?.count || 0);
}

/* ---------- writes ---------- */

/** Creates or updates a roster entry. Used by the console and by sign-in. */
export async function upsertMember(env, { email, name, picture, role, status, note, addedBy }) {
  const target = normaliseEmail(email);
  const existing = await env.DB.prepare(`SELECT ${COLUMNS} FROM admins WHERE email = ?`)
    .bind(target)
    .first();

  if (existing) {
    await env.DB.prepare(
      `UPDATE admins SET
         name = COALESCE(?, name),
         picture = COALESCE(?, picture),
         role = COALESCE(?, role),
         status = COALESCE(?, status),
         note = COALESCE(?, note),
         added_by = COALESCE(?, added_by),
         updated_at = datetime('now')
       WHERE email = ?`
    )
      .bind(
        name ?? null,
        picture ?? null,
        role ?? null,
        status ?? null,
        note ?? null,
        addedBy ?? null,
        target
      )
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO admins (email, name, picture, role, status, note, added_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        target,
        name ?? null,
        picture ?? null,
        role || "admin",
        status || "active",
        note ?? null,
        addedBy ?? null
      )
      .run();
  }

  return getMember(env, target);
}

export async function removeMember(env, email) {
  await env.DB.prepare("DELETE FROM admins WHERE email = ?").bind(normaliseEmail(email)).run();
}

/** Sign-in bookkeeping: profile refresh plus the counters the roster shows. */
export async function touchMemberOnLogin(env, email, { name, picture } = {}) {
  await upsertMember(env, { email, name, picture });
  await env.DB.prepare(
    `UPDATE admins SET
       login_count = login_count + 1,
       last_seen = datetime('now'),
       updated_at = datetime('now')
     WHERE email = ?`
  )
    .bind(normaliseEmail(email))
    .run();
}

/* ---------- sessions ---------- */

export async function createSession(env, session) {
  await env.DB.prepare(
    `INSERT INTO sessions (id, email, name, picture, role, user_agent, device, browser, os, ip_hash, country)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      session.id,
      normaliseEmail(session.email),
      session.name ?? null,
      session.picture ?? null,
      session.role,
      session.userAgent ?? null,
      session.device ?? null,
      session.browser ?? null,
      session.os ?? null,
      session.ipHash ?? null,
      session.country ?? null
    )
    .run();
}

/**
 * @returns {Promise<{ id: string, role: string } | null>} the live session row,
 * or null when it has been revoked or no longer exists.
 */
export async function liveSession(env, id) {
  if (!env?.DB || !id) return null;
  const row = await env.DB.prepare(
    "SELECT id, email, role, status, last_seen FROM sessions WHERE id = ?"
  )
    .bind(String(id))
    .first();
  if (!row || row.status !== "active") return null;

  // Throttled heartbeat: at most one write per session per 5 minutes.
  const stale = await env.DB.prepare(
    "SELECT 1 AS stale FROM sessions WHERE id = ? AND last_seen < datetime('now', '-5 minutes')"
  )
    .bind(String(id))
    .first();
  if (stale) {
    await env.DB.prepare("UPDATE sessions SET last_seen = datetime('now') WHERE id = ?")
      .bind(String(id))
      .run();
  }
  return { id: row.id, email: row.email, role: row.role };
}

export async function listSessions(env, { limit = 40, email = null, activeOnly = false } = {}) {
  const clauses = [];
  const bindings = [];
  if (email) {
    clauses.push("email = ?");
    bindings.push(normaliseEmail(email));
  }
  if (activeOnly) clauses.push("status = 'active'");
  const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";

  const { results } = await env.DB.prepare(
    `SELECT id, email, name, picture, role, login_at, last_seen, user_agent,
            device, browser, os, ip_hash, country, status
       FROM sessions${where}
      ORDER BY login_at DESC, rowid DESC
      LIMIT ?`
  )
    .bind(...bindings, Math.min(Math.max(Number(limit) || 40, 1), 200))
    .all();

  return (results || []).map(shapeSession);
}

/** @returns {Promise<boolean>} true when an active session was actually revoked. */
export async function revokeSession(env, id) {
  const row = await env.DB.prepare("SELECT status FROM sessions WHERE id = ?")
    .bind(String(id))
    .first();
  if (!row || row.status !== "active") return false;
  await env.DB.prepare("UPDATE sessions SET status = 'revoked' WHERE id = ?").bind(String(id)).run();
  return true;
}

export async function revokeSessionsFor(env, email, { exceptId = null } = {}) {
  const clause = exceptId ? " AND id != ?" : "";
  const statement = env.DB.prepare(
    `UPDATE sessions SET status = 'revoked' WHERE email = ? AND status = 'active'${clause}`
  );
  await (exceptId
    ? statement.bind(normaliseEmail(email), String(exceptId))
    : statement.bind(normaliseEmail(email))
  ).run();
}

export async function activeSessionCount(env, email) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM sessions WHERE email = ? AND status = 'active'"
  )
    .bind(normaliseEmail(email))
    .first();
  return Number(row?.count || 0);
}

/* ---------- project diffs ---------- */

const DIFF_FIELDS = [
  "title", "symbol", "category", "year", "tagline", "blurb",
  "image", "url", "stack", "tags", "featured", "published", "sortOrder"
];

/** Field-level before/after, for the audit detail drawer. */
export function diffProjects(before, after) {
  if (!before || !after) return null;
  const changes = [];
  for (const field of DIFF_FIELDS) {
    const from = before[field] ?? null;
    const to = after[field] ?? null;
    const same = Array.isArray(from) || Array.isArray(to)
      ? JSON.stringify(from) === JSON.stringify(to)
      : String(from) === String(to);
    if (same) continue;
    changes.push({
      field,
      from: Array.isArray(from) ? from.join(", ") : from,
      to: Array.isArray(to) ? to.join(", ") : to
    });
  }
  return changes;
}

export { STATUSES };
