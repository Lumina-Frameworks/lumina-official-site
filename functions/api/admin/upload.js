/**
 * POST /api/admin/upload  (admin only, same-origin)
 * multipart/form-data with a single `file` field.
 * Validates type and size, stores in R2 under projects/, returns the public URL.
 */
import { json, requireRole } from "../../_shared/auth.js";
import { auditContext, recordAudit } from "../../_shared/audit.js";

const MAX_BYTES = 5 * 1024 * 1024;

// Extension is derived from the sniffed content type, never the filename.
const ALLOWED = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp"
};

/** PNG / JPEG / WebP magic numbers. Trusting the declared MIME type alone
 *  would let someone store an HTML file that later gets served from our
 *  media domain. */
function sniffImageType(bytes) {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  const webp = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
  if (riff === "RIFF" && webp === "WEBP") return "image/webp";
  return null;
}

function slugifyFilename(name) {
  return String(name || "image")
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "image";
}

async function shortHash(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest).slice(0, 4)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function onRequestPost({ request, env }) {
  const guard = await requireRole(request, env, "admin");
  if (!guard.ok) return guard.response;

  if (!env.MEDIA) return json({ error: "Media storage is not configured." }, 500);

  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return json({ error: "Send the image as multipart/form-data." }, 400);
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "Could not read the upload." }, 400);
  }

  const file = form.get("file");
  if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") {
    return json({ error: "No file was included in the upload." }, 400);
  }
  if (file.size > MAX_BYTES) {
    return json({ error: `Image must be 5MB or smaller. Got ${(file.size / 1048576).toFixed(1)}MB.` }, 413);
  }

  const buffer = await file.arrayBuffer();
  const sniffed = sniffImageType(new Uint8Array(buffer));
  if (!sniffed) {
    return json({ error: "Only PNG, JPEG, or WebP images are allowed." }, 415);
  }

  const extension = ALLOWED[sniffed];
  const key = `projects/${slugifyFilename(file.name)}-${await shortHash(buffer)}.${extension}`;

  try {
    await env.MEDIA.put(key, buffer, {
      httpMetadata: {
        contentType: sniffed,
        cacheControl: "public, max-age=31536000, immutable"
      }
    });
  } catch (err) {
    return json({ error: "Could not store the image.", detail: String(err?.message || err) }, 500);
  }

  const base = String(env.MEDIA_BASE_URL || "https://media.lumina-frameworks.com").replace(/\/+$/, "");
  const url = `${base}/${key}`;

  const context = await auditContext(request, env);
  await recordAudit(env, {
    actor: guard.session.email,
    role: guard.session.role,
    action: "media.upload",
    entity: "project",
    entityId: key,
    summary: `Uploaded ${sniffed.replace("image/", "").toUpperCase()} · ${Math.round(buffer.byteLength / 1024)}KB`,
    details: { key, url, bytes: buffer.byteLength, type: sniffed, name: file.name },
    context
  });

  return json({ ok: true, key, url, bytes: buffer.byteLength, type: sniffed }, 201);
}
