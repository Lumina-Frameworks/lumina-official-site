/**
 * Audit trail for the admin console.
 *
 * Every mutation and every rejected access lands here: who did it, which record,
 * from where, on what device, and what actually changed. Writes never throw into
 * the caller, because a logging failure must not break the action it describes.
 *
 * Storage notes:
 * - Cloudflare hands us a *derived* IP that is random per request, so it cannot
 *   be used to recognise a returning operator. The raw address is truncated to
 *   its /24 (v4) or /48 (v6) network and stored hashed with AUTH_SECRET as the
 *   pepper. Enough to spot "same network", not enough to be a people-tracking
 *   database if the table ever leaked.
 * - `details` is JSON: the before/after diff for updates, the key facts for
 *   everything else.
 */

const ALLOWED_ROLES = new Set(["owner", "admin", "viewer"]);

export const AUDIT_PAGE_DEFAULT = 50;
export const AUDIT_PAGE_MAX = 200;

/* ---------- request context ---------- */

/** Truncates to the network, so the digest identifies a network not a person. */
function networkOf(ip) {
  const value = String(ip || "").trim();
  if (!value) return "";
  if (value.includes(":")) return value.split(":").slice(0, 3).join(":") + "::/48";
  const parts = value.split(".");
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.0/24` : value;
}

async function hashNetwork(network, secret) {
  if (!network) return null;
  const data = new TextEncoder().encode(`lumina-audit:${secret}:${network}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest).slice(0, 8)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Best-effort device fingerprint, derived and then discarded. `device` is what
 * the audit table filters on; the raw user agent is kept verbatim for the one
 * case where the label is not enough.
 */
export function describeUserAgent(userAgent) {
  const ua = String(userAgent || "");
  if (!ua) return { device: "Unknown device", browser: null, os: null };

  let os = "Unknown OS";
  if (/Windows NT 10/.test(ua)) os = "Windows 10/11";
  else if (/Windows NT/.test(ua)) os = "Windows";
  else if (/iPhone|iPod/.test(ua)) os = "iOS";
  else if (/iPad/.test(ua)) os = "iPadOS";
  else if (/Android/.test(ua)) os = "Android";
  else if (/Mac OS X/.test(ua)) os = "macOS";
  else if (/CrOS/.test(ua)) os = "ChromeOS";
  else if (/Linux/.test(ua)) os = "Linux";

  let browser = null;
  // Safari is deliberately last: its UA carries "Version/17.5" before the real
  // "Safari/605.1.15" build number, and the build number is useless to a human.
  const chromiumFamily = ua.match(/(Edg|OPR|SamsungBrowser|Firefox|FxiOS|CriOS|Chrome)\/([\d.]+)/);
  const safariFamily = ua.match(/Version\/([\d.]+)[^)]*Safari/);
  if (chromiumFamily) {
    const names = {
      Edg: "Edge",
      OPR: "Opera",
      SamsungBrowser: "Samsung Internet",
      Firefox: "Firefox",
      FxiOS: "Firefox",
      CriOS: "Chrome",
      Chrome: "Chrome"
    };
    browser = `${names[chromiumFamily[1]] || chromiumFamily[1]} ${chromiumFamily[2].split(".")[0]}`;
  } else if (safariFamily) {
    browser = `Safari ${safariFamily[1].split(".")[0]}`;
  } else if (/curl|node|python|wrangler/i.test(ua)) {
    browser = "CLI";
  }

  const mobile = /iPhone|iPod|Android.*Mobile|Windows Phone/.test(ua);
  const tablet = /iPad|Tablet|Android(?!.*Mobile)/.test(ua);
  const device = tablet ? "Tablet" : mobile ? "Mobile" : "Desktop";

  return { device: browser ? `${device} · ${browser}` : device, browser, os };
}

/** Everything a log row needs that only the request knows. */
export async function auditContext(request, env) {
  const userAgent = request?.headers?.get("User-Agent") || "";
  const ip = request?.headers?.get("CF-Connecting-IP") || "";
  const { device, browser, os } = describeUserAgent(userAgent);
  return {
    device,
    browser,
    os,
    userAgent: userAgent || null,
    ipHash: await hashNetwork(networkOf(ip), env?.AUTH_SECRET || "unpeppered"),
    country: request?.cf?.country || request?.headers?.get("CF-IPCountry") || null,
    city: request?.cf?.city || null,
    method: request?.method || null,
    path: (() => {
      try {
        return new URL(request.url).pathname;
      } catch {
        return null;
      }
    })()
  };
}

/* ---------- writes ---------- */

/**
 * Appends one audit row.
 * @param {object} env
 * @param {object} event  actor, action, and any of entity/entityId/summary/status/details/role/context
 */
export async function recordAudit(env, event = {}) {
  if (!env?.DB) return; // No database (chat-only dev server): logging is a no-op.
  const {
    actor = "system",
    role = null,
    action = "unknown",
    status = "ok",
    entity = null,
    entityId = null,
    summary = null,
    details = null,
    context = null
  } = event;

  try {
    await env.DB.prepare(
      `INSERT INTO audit_log
         (actor, actor_role, action, status, entity, entity_id, summary,
          method, path, ip_hash, country, city, user_agent, device, browser, os, details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        String(actor).toLowerCase(),
        role,
        String(action),
        String(status),
        entity,
        entityId,
        summary,
        context?.method ?? null,
        context?.path ?? null,
        context?.ipHash ?? null,
        context?.country ?? null,
        context?.city ?? null,
        context?.userAgent ?? null,
        context?.device ?? null,
        context?.browser ?? null,
        context?.os ?? null,
        details ? JSON.stringify(details) : null
      )
      .run();
  } catch (err) {
    console.error("audit write failed:", err?.message || err);
  }
}

/* ---------- reads ---------- */

export function parseAuditFilters(searchParams) {
  const params = searchParams instanceof URLSearchParams ? searchParams : new URLSearchParams();
  const limitRaw = Number.parseInt(params.get("limit"), 10);
  const offsetRaw = Number.parseInt(params.get("offset"), 10);
  const role = String(params.get("role") || "").trim().toLowerCase();
  const status = String(params.get("status") || "").trim().toLowerCase();

  return {
    limit: Number.isInteger(limitRaw) ? Math.min(Math.max(limitRaw, 1), AUDIT_PAGE_MAX) : AUDIT_PAGE_DEFAULT,
    offset: Number.isInteger(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0,
    actor: String(params.get("actor") || "").trim().toLowerCase() || null,
    action: String(params.get("action") || "").trim() || null,
    entity: String(params.get("entity") || "").trim().toLowerCase() || null,
    status: ["ok", "denied", "failed"].includes(status) ? status : null,
    role: ALLOWED_ROLES.has(role) ? role : null,
    search: String(params.get("q") || "").trim() || null,
    // Inclusive ISO-ish date bounds, compared directly against the stored
    // 'YYYY-MM-DD HH:MM:SS' strings.
    since: /^\d{4}-\d{2}-\d{2}/.test(params.get("since") || "") ? params.get("since") : null,
    until: /^\d{4}-\d{2}-\d{2}/.test(params.get("until") || "") ? params.get("until") : null
  };
}

function auditWhere(filters) {
  const clauses = [];
  const bindings = [];

  if (filters.actor) {
    clauses.push("actor = ?");
    bindings.push(filters.actor);
  }
  if (filters.role) {
    clauses.push("actor_role = ?");
    bindings.push(filters.role);
  }
  if (filters.status) {
    clauses.push("status = ?");
    bindings.push(filters.status);
  }
  if (filters.entity) {
    clauses.push("entity = ?");
    bindings.push(filters.entity);
  }
  if (filters.action) {
    // Prefix match so "project." covers the whole family.
    clauses.push("action LIKE ?");
    bindings.push(`${filters.action.replace(/[%_]/g, "")}%`);
  }
  if (filters.search) {
    clauses.push("(summary LIKE ? OR entity_id LIKE ? OR actor LIKE ? OR action LIKE ?)");
    const like = `%${filters.search}%`;
    bindings.push(like, like, like, like);
  }
  if (filters.since) {
    clauses.push("created_at >= ?");
    bindings.push(filters.since);
  }
  if (filters.until) {
    // A bare date means "through the end of that day".
    clauses.push("created_at <= ?");
    bindings.push(filters.until.length === 10 ? `${filters.until} 23:59:59` : filters.until);
  }

  return { where: clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "", bindings };
}

export function shapeAuditRow(row) {
  let details = null;
  if (row.details) {
    try {
      details = JSON.parse(row.details);
    } catch {
      details = { raw: row.details };
    }
  }
  return {
    id: Number(row.id),
    at: row.created_at,
    actor: row.actor,
    role: row.actor_role || null,
    action: row.action,
    status: row.status,
    entity: row.entity || null,
    entityId: row.entity_id || null,
    summary: row.summary || null,
    device: row.device || null,
    browser: row.browser || null,
    os: row.os || null,
    country: row.country || null,
    city: row.city || null,
    network: row.ip_hash || null,
    method: row.method || null,
    path: row.path || null,
    userAgent: row.user_agent || null,
    details
  };
}

const AUDIT_COLUMNS =
  "id, created_at, actor, actor_role, action, status, entity, entity_id, summary, method, path, ip_hash, country, city, user_agent, device, browser, os, details";

export async function listAuditEvents(env, filters) {
  const { where, bindings } = auditWhere(filters);
  const total = await env.DB.prepare(`SELECT COUNT(*) AS count FROM audit_log${where}`)
    .bind(...bindings)
    .first();

  const { results } = await env.DB.prepare(
    `SELECT ${AUDIT_COLUMNS} FROM audit_log${where} ORDER BY id DESC LIMIT ? OFFSET ?`
  )
    .bind(...bindings, filters.limit, filters.offset)
    .all();

  return {
    events: (results || []).map(shapeAuditRow),
    total: Number(total?.count || 0)
  };
}

/** Every matching row, for the CSV export. Capped so an export can't run away. */
export async function collectAuditEvents(env, filters, cap = 5000) {
  const { where, bindings } = auditWhere(filters);
  const { results } = await env.DB.prepare(
    `SELECT ${AUDIT_COLUMNS} FROM audit_log${where} ORDER BY id DESC LIMIT ?`
  )
    .bind(...bindings, cap)
    .all();
  return (results || []).map(shapeAuditRow);
}

export function auditToCsv(events) {
  const columns = [
    "id", "at", "actor", "role", "action", "status", "entity", "entityId",
    "summary", "device", "browser", "os", "country", "city", "network",
    "method", "path", "details"
  ];
  const cell = (value) => {
    if (value === null || value === undefined) return "";
    const text = typeof value === "object" ? JSON.stringify(value) : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const rows = events.map((event) => columns.map((key) => cell(event[key])).join(","));
  return [columns.join(","), ...rows].join("\r\n");
}

/** Counters for the overview tab. */
export async function auditSummary(env, sinceHours = 24) {
  const since = `-${Math.max(1, sinceHours)} hours`;
  const row = await env.DB.prepare(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN status = 'denied' THEN 1 ELSE 0 END) AS denied,
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
       COUNT(DISTINCT actor) AS actors
     FROM audit_log
     WHERE created_at >= datetime('now', ?)`
  )
    .bind(since)
    .first();

  const { results } = await env.DB.prepare(
    `SELECT action, COUNT(*) AS count
       FROM audit_log
      WHERE created_at >= datetime('now', ?)
      GROUP BY action
      ORDER BY count DESC
      LIMIT 6`
  )
    .bind(since)
    .all();

  return {
    windowHours: sinceHours,
    total: Number(row?.total || 0),
    denied: Number(row?.denied || 0),
    failed: Number(row?.failed || 0),
    actors: Number(row?.actors || 0),
    topActions: (results || []).map((r) => ({ action: r.action, count: Number(r.count) }))
  };
}

/** Housekeeping, run opportunistically from the audit list endpoint. */
export async function pruneAuditLog(env, keepDays = 180) {
  if (!env?.DB) return;
  try {
    await env.DB.prepare("DELETE FROM audit_log WHERE created_at < datetime('now', ?)")
      .bind(`-${keepDays} days`)
      .run();
    await env.DB.prepare("DELETE FROM sessions WHERE login_at < datetime('now', '-60 days')").run();
  } catch (err) {
    console.error("audit prune failed:", err?.message || err);
  }
}
