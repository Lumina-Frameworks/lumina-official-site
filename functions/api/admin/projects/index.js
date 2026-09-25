/**
 * /api/admin/projects  (admin only, same-origin)
 *   GET  -> every project, including unpublished drafts
 *   POST -> create a project
 */
import { json, readJsonBody, requireAdmin } from "../../../_shared/auth.js";
import {
  getProject,
  listProjects,
  slugify,
  validateProjectInput
} from "../../../_shared/projects.js";

export async function onRequestGet({ request, env }) {
  const guard = await requireAdmin(request, env);
  if (!guard.ok) return guard.response;

  try {
    const projects = await listProjects(env, { includeUnpublished: true });
    return json({ projects });
  } catch (err) {
    return json({ error: "Could not load projects.", detail: String(err?.message || err) }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  const guard = await requireAdmin(request, env);
  if (!guard.ok) return guard.response;

  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;

  const validated = validateProjectInput(parsed.body);
  if (!validated.ok) {
    return json({ error: validated.errors[0], errors: validated.errors }, 400);
  }

  const base = slugify(parsed.body?.slug || validated.value.title);
  if (!base) return json({ error: "Could not derive a slug from that title." }, 400);

  // Find a free slug.
  let slug = base;
  for (let attempt = 2; attempt < 50; attempt += 1) {
    if (!(await getProject(env, slug))) break;
    slug = `${base}-${attempt}`;
  }

  const value = validated.value;
  try {
    await env.DB.prepare(
      `INSERT INTO projects
         (slug, title, symbol, category, year, image_url, blurb, tagline, stack, tags, url, featured, published, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        slug,
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
        value.sort_order
      )
      .run();
  } catch (err) {
    return json({ error: "Could not create project.", detail: String(err?.message || err) }, 500);
  }

  return json({ ok: true, project: await getProject(env, slug) }, 201);
}
