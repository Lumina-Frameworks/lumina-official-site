/**
 * /api/admin/projects/:slug  (admin only, same-origin)
 *   PUT    -> full replace of a project
 *   DELETE -> soft delete (unpublish). Pass ?hard=1 to remove the row.
 *
 * Renaming a slug is intentionally not supported: slugs are the public
 * identity of a project and changing one would break existing links.
 */
import { json, readJsonBody, requireAdmin } from "../../../_shared/auth.js";
import { getProject, validateProjectInput } from "../../../_shared/projects.js";

export async function onRequestPut({ request, env, params }) {
  const guard = await requireAdmin(request, env);
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
    return json({ error: "Could not update project.", detail: String(err?.message || err) }, 500);
  }

  return json({ ok: true, project: await getProject(env, slug) });
}

export async function onRequestDelete({ request, env, params }) {
  const guard = await requireAdmin(request, env);
  if (!guard.ok) return guard.response;

  const slug = String(params?.slug || "");
  const existing = await getProject(env, slug);
  if (!existing) return json({ error: "Project not found." }, 404);

  const hard = new URL(request.url).searchParams.get("hard") === "1";

  try {
    if (hard) {
      await env.DB.prepare("DELETE FROM projects WHERE slug = ?").bind(slug).run();
      return json({ ok: true, deleted: "hard", slug });
    }
    await env.DB.prepare(
      "UPDATE projects SET published = 0, updated_at = datetime('now') WHERE slug = ?"
    )
      .bind(slug)
      .run();
    return json({ ok: true, deleted: "soft", slug });
  } catch (err) {
    return json({ error: "Could not delete project.", detail: String(err?.message || err) }, 500);
  }
}
