/**
 * POST /api/auth/logout -> clears the session cookie.
 */
import { clearedSessionCookie, json } from "../../_shared/auth.js";

export async function onRequestPost() {
  return json({ ok: true }, 200, { "Set-Cookie": clearedSessionCookie() });
}
