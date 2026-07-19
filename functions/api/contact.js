/**
 * Cloudflare Pages Function: contact form → branded email via Resend
 * Recipients: aliffros@ + amirhafizi@ lumina-frameworks.com
 *
 * Env:
 * - RESEND_API_KEY (secret)
 * - CONTACT_FROM (optional, e.g. "Lumina Frameworks <hello@lumina-frameworks.com>")
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

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400"
    }
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
