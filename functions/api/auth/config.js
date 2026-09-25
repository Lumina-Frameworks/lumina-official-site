/**
 * GET /api/auth/config -> public auth settings for admin.html.
 * The Google client ID is not a secret (it ships in the browser either way),
 * but serving it keeps a single source of truth: the env var.
 */
import { json } from "../../_shared/auth.js";

export async function onRequestGet({ env }) {
  return json({
    clientId: env.GOOGLE_CLIENT_ID || null,
    configured: Boolean(env.GOOGLE_CLIENT_ID && env.AUTH_SECRET)
  });
}
