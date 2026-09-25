/**
 * GET /api/admin/sessions            -> live sessions, newest first
 * GET /api/admin/sessions?format=csv -> the same list as a download
 *
 * Admin or owner. Revoking a device is at /api/admin/sessions/:id.
 */
import { json, requireRole } from "../../../_shared/auth.js";
import { listSessions } from "../../../_shared/admins.js";
import { auditToCsv } from "../../../_shared/audit.js";

export async function onRequestGet({ request, env }) {
  const guard = await requireRole(request, env, "admin");
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const scope = url.searchParams.get("scope") || "active";

  try {
    const sessions = (await listSessions(env, { limit: 100, activeOnly: scope === "active" })).map(
      (session) => ({ ...session, current: session.id === guard.session.sid })
    );

    if (url.searchParams.get("format") === "csv") {
      const stamp = new Date().toISOString().slice(0, 10);
      return new Response(
        auditToCsv(
          sessions.map((s) => ({
            id: s.id,
            at: s.loginAt,
            actor: s.email,
            role: s.role,
            action: "session.open",
            status: s.status,
            entity: "session",
            entityId: s.id,
            summary: `${s.device || "Unknown device"}${s.country ? ` · ${s.country}` : ""}`,
            device: s.device,
            browser: s.browser,
            os: s.os,
            country: s.country,
            network: s.ipHash,
            method: null,
            path: null,
            details: { lastSeen: s.lastSeen, current: s.current }
          }))
        ),
        {
          status: 200,
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="lumina-sessions-${stamp}.csv"`,
            "Cache-Control": "no-store"
          }
        }
      );
    }

    return json({ sessions, viewer: { email: guard.session.email, role: guard.session.role } });
  } catch (err) {
    return json({ error: "Could not load sessions.", detail: String(err?.message || err) }, 500);
  }
}
