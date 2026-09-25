/**
 * GET /api/admin/audit  (admin or owner)
 *   ?limit=50&offset=0&actor=&action=&entity=&status=&role=&q=&since=&until=
 *   ?format=csv downloads every matching row instead of a page
 *
 * Reads only. Housekeeping (pruning old rows) happens here too, opportunistically,
 * so the log cannot grow without bound on a site nobody logs into.
 */
import { json, requireRole } from "../../../_shared/auth.js";
import {
  auditToCsv,
  collectAuditEvents,
  listAuditEvents,
  parseAuditFilters,
  pruneAuditLog
} from "../../../_shared/audit.js";
import { listSessions } from "../../../_shared/admins.js";

export async function onRequestGet({ request, env }) {
  const guard = await requireRole(request, env, "admin");
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const filters = parseAuditFilters(url.searchParams);

  try {
    if (url.searchParams.get("format") === "csv") {
      const events = await collectAuditEvents(env, { ...filters, limit: 5000, offset: 0 });
      const stamp = new Date().toISOString().slice(0, 10);
      return new Response(auditToCsv(events), {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="lumina-audit-${stamp}.csv"`,
          "Cache-Control": "no-store"
        }
      });
    }

    const [page, sessions] = await Promise.all([
      listAuditEvents(env, filters),
      listSessions(env, { limit: 25 })
    ]);

    // One sweep per read is plenty; failures are swallowed inside.
    await pruneAuditLog(env, 180);

    return json({
      events: page.events,
      total: page.total,
      limit: filters.limit,
      offset: filters.offset,
      sessions: sessions.map((session) => ({
        ...session,
        current: session.id === guard.session.sid
      })),
      viewer: { email: guard.session.email, role: guard.session.role }
    });
  } catch (err) {
    return json({ error: "Could not read the audit log.", detail: String(err?.message || err) }, 500);
  }
}
