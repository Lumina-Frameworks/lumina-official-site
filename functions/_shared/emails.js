/**
 * The bootstrap allowlist, in one place.
 *
 * auth.js and admins.js both need it: auth.js to decide who may sign in,
 * admins.js to mark those entries as locked owners. Keeping it here avoids a
 * circular import between the two.
 */

export function adminEmails(env) {
  return String(env?.ADMIN_EMAILS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export function isEnvAdmin(env, email) {
  return adminEmails(env).includes(String(email || "").trim().toLowerCase());
}
