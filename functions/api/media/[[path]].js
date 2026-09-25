/**
 * GET /api/media/:key   (public)
 *
 * Serves an uploaded image straight out of R2.
 *
 * Why this exists: uploads go to R2, but a bucket is private until it is given a
 * public path, and neither `media.lumina-frameworks.com` (a custom domain that
 * has to be attached in the dashboard) nor the bucket's `r2.dev` URL was ever
 * enabled. So every URL the upload endpoint handed back pointed at a host that
 * did not resolve. Routing media through the Pages Function that is already
 * deployed means uploads work with no extra setup.
 *
 * Cloudflare caches the response at the edge, so this is not a Function
 * invocation on every image view.
 *
 * When a custom domain is attached to the bucket later, point MEDIA_BASE_URL at
 * it and this route simply stops being used. Nothing else has to change.
 */
import { json } from "../../_shared/auth.js";

const CONTENT_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
  svg: "image/svg+xml"
};

/** Served formats only. Anything else in the bucket is not ours to hand out. */
const ALLOWED = new Set(Object.keys(CONTENT_TYPES));

export async function onRequestGet({ request, env, params }) {
  if (!env.MEDIA) return json({ error: "Media storage is not configured." }, 500);

  // The route is a splat, so params.path is an array of segments.
  const segments = Array.isArray(params?.path) ? params.path : [params?.path].filter(Boolean);
  const key = segments.map((part) => decodeURIComponent(String(part))).join("/");

  if (!key) return json({ error: "No media key given." }, 400);
  // No traversal, no absolute paths: the bucket only ever holds keys we wrote.
  if (key.includes("..") || key.startsWith("/")) {
    return json({ error: "Invalid media key." }, 400);
  }

  const extension = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
  if (!ALLOWED.has(extension)) {
    return json({ error: "Unsupported media type." }, 415);
  }
  const type = CONTENT_TYPES[extension];

  try {
    const object = await env.MEDIA.get(key);
    if (!object) return json({ error: "Not found." }, 404);

    const headers = new Headers({
      "Content-Type": object.httpMetadata?.contentType || type,
      "Cache-Control": "public, max-age=31536000, immutable",
      // These are uploads, never scripts, but a sniffing browser is a needless
      // risk when the bucket is operator-writable.
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Access-Control-Allow-Origin": "*"
    });
    if (object.httpEtag) headers.set("ETag", object.httpEtag);
    if (object.size !== undefined) headers.set("Content-Length", String(object.size));

    // Conditional request: an immutable object never needs re-sending.
    const ifNoneMatch = request.headers.get("If-None-Match");
    if (ifNoneMatch && object.httpEtag && ifNoneMatch === object.httpEtag) {
      return new Response(null, { status: 304, headers });
    }

    return new Response(object.body, { status: 200, headers });
  } catch (err) {
    return json({ error: "Could not read the image.", detail: String(err?.message || err) }, 500);
  }
}
