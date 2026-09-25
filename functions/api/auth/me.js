/**
 * GET /api/auth/me -> the current admin session, or { authenticated: false }.
 * Used by admin.html to decide whether to show the login gate.
 */
import { getSession, json } from "../../_shared/auth.js";

export async function onRequestGet({ request, env }) {
  const session = await getSession(request, env);
  if (!session) return json({ authenticated: false });
  return json({ authenticated: true, email: session.email });
}
