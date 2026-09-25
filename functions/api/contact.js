/**
 * Cloudflare Pages Function: contact form → branded email via Resend
 * Recipients: see CONTACT_RECIPIENTS in ../_shared/contact-email.js
 *
 * Env:
 * - RESEND_API_KEY (secret)
 * - CONTACT_FROM (optional, e.g. "Lumina Frameworks <hello@lumina-frameworks.com>")
 *
 * Deliberately no CORS headers. A wildcard Access-Control-Allow-Origin let any
 * website POST this form and send mail through the project's Resend account.
 * The form is same-origin, so no CORS headers are needed.
 */
import { sendContactEmail } from "../_shared/contact-email.js";

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  try {
    const result = await sendContactEmail(env, body);
    return json({ ok: true, id: result.id });
  } catch (err) {
    const status = err?.status || 500;
    return json(
      {
        error: err?.message || "Transmission failed.",
        detail: err?.detail || undefined
      },
      status
    );
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
