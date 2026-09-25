/**
 * GET /api/admin/overview  (any signed-in member)
 *
 * Everything the console's first tab renders, in one request: project counts,
 * roster counts, live sessions, and a 14-day activity histogram.
 */
import { json, requireRole } from "../../_shared/auth.js";
import { auditSummary, shapeAuditRow } from "../../_shared/audit.js";
import { listAdmins, listSessions } from "../../_shared/admins.js";

export async function onRequestGet({ request, env }) {
  const guard = await requireRole(request, env, "viewer");
  if (!guard.ok) return guard.response;

  try {
    const projects = await env.DB.prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN published = 1 THEN 1 ELSE 0 END) AS published,
         SUM(CASE WHEN published = 0 THEN 1 ELSE 0 END) AS drafts,
         SUM(CASE WHEN featured = 1 THEN 1 ELSE 0 END) AS featured,
         MAX(updated_at) AS last_updated
       FROM projects`
    ).first();

    const { results: recent } = await env.DB.prepare(
      `SELECT * FROM (
         SELECT id, created_at, actor, actor_role, action, status, entity, entity_id, summary,
                method, path, ip_hash, country, user_agent, device, browser, os, details
           FROM audit_log ORDER BY id DESC LIMIT 8
       ) ORDER BY id DESC`
    ).all();

    const { results: histogram } = await env.DB.prepare(
      `SELECT date(created_at) AS day, COUNT(*) AS count
         FROM audit_log
        WHERE created_at >= datetime('now', '-14 days')
        GROUP BY day
        ORDER BY day ASC`
    ).all();

    // Fill the quiet days, or the chart lies by omission.
    const days = new Map((histogram || []).map((row) => [row.day, Number(row.count)]));
    const today = new Date();
    const series = [];
    for (let back = 13; back >= 0; back -= 1) {
      const date = new Date(today.getTime() - back * 86400_000);
      const key = date.toISOString().slice(0, 10);
      series.push({ day: key, count: days.get(key) || 0 });
    }

    const [summary, admins, sessions] = await Promise.all([
      auditSummary(env, 24),
      listAdmins(env),
      listSessions(env, { limit: 5, activeOnly: true })
    ]);

    return json({
      projects: {
        total: Number(projects?.total || 0),
        published: Number(projects?.published || 0),
        drafts: Number(projects?.drafts || 0),
        featured: Number(projects?.featured || 0),
        lastUpdated: projects?.last_updated || null
      },
      roster: {
        total: admins.length,
        owners: admins.filter((a) => a.role === "owner" && a.status === "active").length,
        admins: admins.filter((a) => a.role === "admin" && a.status === "active").length,
        viewers: admins.filter((a) => a.role === "viewer" && a.status === "active").length,
        suspended: admins.filter((a) => a.status === "suspended").length
      },
      sessions: {
        live: sessions.length,
        recent: sessions.map((session) => ({
          ...session,
          current: session.id === guard.session.sid
        }))
      },
      audit: summary,
      series,
      recent: (recent || []).map(shapeAuditRow),
      viewer: { email: guard.session.email, role: guard.session.role }
    });
  } catch (err) {
    return json({ error: "Could not load the overview.", detail: String(err?.message || err) }, 500);
  }
}
