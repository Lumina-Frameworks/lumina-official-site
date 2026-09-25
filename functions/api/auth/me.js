/**
 * GET /api/auth/me -> the current session, or { authenticated: false }.
 * Used by admin.html to decide whether to show the login gate, and to render
 * the operator chip. The role decides which tabs and buttons appear.
 */
import { getSession, json } from "../../_shared/auth.js";
import { getMember } from "../../_shared/admins.js";

export async function onRequestGet({ request, env }) {
  const session = await getSession(request, env);
  if (!session) return json({ authenticated: false });

  const member = await getMember(env, session.email);
  return json({
    authenticated: true,
    email: session.email,
    role: session.role,
    name: member?.name || null,
    picture: member?.picture || null,
    sid: session.sid
  });
}
