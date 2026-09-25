/**
 * /api/admin/projects/:slug  (admin or owner, same-origin)
 *   PUT    -> full replace of a project
 *   DELETE -> soft delete (unpublish). Pass ?hard=1 to remove the row.
 *
 * Renaming a slug is intentionally not supported: slugs are the public
 * identity of a project and changing one would break existing links.
 *
 * The PUT handler records a field-level diff, so the audit drawer can answer
 * "what exactly changed" without diffing row snapshots by hand.
 */
import { json, readJsonBody, requireRole } from "../../../_shared/auth.js";
import { getProject, validateProjectInput } from "../../../_shared/projects.js";
import { diffProjects } from "../../../_shared/admins.js";
import { auditContext, recordAudit } from "../../../_shared/audit.js";

export async function onRequestPut({ request, env, params }) {
  const guard = await requireRole(request, env, "admin");
  if (!guard.ok) return guard.response;

  const slug = String(params?.slug || "");
  const existing = await getProject(env, slug);
  if (!existing) return json({ error: "Project not found." }, 404);

  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;

  const validated = validateProjectInput(parsed.body);
  if (!validated.ok) {
    return json({ error: validated.errors[0], errors: validated.errors }, 400);
  }

  const value = validated.value;
  const context = await auditContext(request, env);

  try {
    await env.DB.prepare(
      `UPDATE projects SET
         title = ?, symbol = ?, category = ?, year = ?, image_url = ?, blurb = ?, tagline = ?,
         stack = ?, tags = ?, url = ?, featured = ?, published = ?, sort_order = ?,
         updated_at = datetime('now')
       WHERE slug = ?`
    )
      .bind(
        value.title,
        value.symbol,
        value.category,
        value.year,
        value.image_url,
        value.blurb,
        value.tagline,
        value.stack,
        value.tags,
        value.url,
        value.featured,
        value.published,
        value.sort_order,
        slug
      )
      .run();
  } catch (err) {
    await recordAudit(env, {
      actor: guard.session.email,
      role: guard.session.role,
      action: "project.update",
      status: "failed",
      entity: "project",
      entityId: slug,
      summary: `Could not save "${existing.title}"`,
      details: { error: String(err?.message || err) },
      context
    });
    return json({ error: "Could not update project.", detail: String(err?.message || err) }, 500);
  }

  const project = await getProject(env, slug);
  const changes = diffProjects(existing, project) || [];

  // A save that changed nothing is still worth a row: it is the difference
  // between "nobody touched this" and "someone opened it and pressed save".
  const visibility =
    existing.published !== project.published
      ? project.published
        ? " · now live"
        : " · now a draft"
      : "";

  await recordAudit(env, {
    actor: guard.session.email,
    role: guard.session.role,
    action: "project.update",
    entity: "project",
    entityId: slug,
    summary: changes.length
      ? `Saved "${project.title}" · ${changes.length} field${changes.length === 1 ? "" : "s"} changed${visibility}`
      : `Saved "${project.title}" · no changes${visibility}`,
    details: { changes },
    context
  });

  return json({ ok: true, project });
}

export async function onRequestDelete({ request, env, params }) {
  const guard = await requireRole(request, env, "admin");
  if (!guard.ok) return guard.response;

  const slug = String(params?.slug || "");
  const existing = await getProject(env, slug);
  if (!existing) return json({ error: "Project not found." }, 404);

  const hard = new URL(request.url).searchParams.get("hard") === "1";
  const context = await auditContext(request, env);

  try {
    if (hard) {
      await env.DB.prepare("DELETE FROM projects WHERE slug = ?").bind(slug).run();
    } else {
      await env.DB.prepare(
        "UPDATE projects SET published = 0, updated_at = datetime('now') WHERE slug = ?"
      )
        .bind(slug)
        .run();
    }
  } catch (err) {
    await recordAudit(env, {
      actor: guard.session.email,
      role: guard.session.role,
      action: hard ? "project.delete" : "project.unpublish",
      status: "failed",
      entity: "project",
      entityId: slug,
      summary: `Could not ${hard ? "delete" : "unpublish"} "${existing.title}"`,
      details: { error: String(err?.message || err) },
      context
    });
    return json({ error: "Could not delete project.", detail: String(err?.message || err) }, 500);
  }

  await recordAudit(env, {
    actor: guard.session.email,
    role: guard.session.role,
    action: hard ? "project.delete" : "project.unpublish",
    entity: "project",
    entityId: slug,
    summary: hard
      ? `Permanently deleted "${existing.title}"`
      : `Unpublished "${existing.title}"`,
    details: hard
      ? { title: existing.title, category: existing.category, year: existing.year }
      : { title: existing.title, previousPublished: existing.published },
    context
  });

  return json({ ok: true, deleted: hard ? "hard" : "soft", slug });
}
