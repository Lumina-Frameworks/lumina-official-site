/**
 * GET /api/admin/media  (admin or owner)
 *
 * Lists what is actually in the media bucket. The upload flow only ever proved
 * that R2 accepted a PUT; there was no way to confirm the bytes were there under
 * the key the database recorded, which is exactly the gap that let every image
 * 404 silently.
 */
import { json, requireRole } from "../../../_shared/auth.js";

export async function onRequestGet({ request, env }) {
  const guard = await requireRole(request, env, "admin");
  if (!guard.ok) return guard.response;
  if (!env.MEDIA) return json({ error: "Media storage is not configured." }, 500);

  const url = new URL(request.url);
  const prefix = url.searchParams.get("prefix") || "projects/";

  try {
    const listed = await env.MEDIA.list({ prefix, limit: 100 });
    return json({
      prefix,
      truncated: Boolean(listed.truncated),
      count: (listed.objects || []).length,
      totalBytes: (listed.objects || []).reduce((sum, item) => sum + (item.size || 0), 0),
      objects: (listed.objects || [])
        .sort((a, b) => String(b.uploaded).localeCompare(String(a.uploaded)))
        .map((item) => ({
          key: item.key,
          size: item.size,
          uploaded: item.uploaded ? new Date(item.uploaded).toISOString() : null,
          etag: item.etag || null
        }))
    });
  } catch (err) {
    return json({ error: "Could not list media.", detail: String(err?.message || err) }, 500);
  }
}
