/**
 * Shared contact-mail helpers for Pages Functions + local chat-server.
 * Sends branded HTML email via Resend.
 */

export const CONTACT_RECIPIENTS = [
  // Deliver to real inboxes. @lumina-frameworks.com Custom addresses must exist
  // in Cloudflare Email Routing before those aliases can receive mail.
  "aliffprime3@gmail.com",
  "amirhafizi443@gmail.com"
];

const INTEREST_META = {
  DIY: { label: "DIY · Do It Yourself", tone: "#7dd9ff" },
  DWY: { label: "DWY · Done With You", tone: "#1aa3ff" },
  DFY: { label: "DFY · Done For You", tone: "#3dde9a" }
};

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function normalizeContactPayload(body = {}) {
  const name = String(body.name || "").trim().slice(0, 120);
  const email = String(body.email || "").trim().slice(0, 180);
  const interest = String(body.interest || "").trim().toUpperCase().slice(0, 12);
  const message = String(body.message || "").trim().slice(0, 5000);
  return { name, email, interest, message };
}

export function validateContactPayload({ name, email, interest, message }) {
  if (!name || !email || !interest || !message) {
    return "Fill in all fields before transmitting.";
  }
  // TLD must be at least two letters. The looser version accepted "x@y.z",
  // which Resend rejects with a 422, turning a typo into a confusing 500.
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) {
    return "A valid email is required.";
  }
  if (!INTEREST_META[interest]) {
    return "Select a valid service interest.";
  }
  return null;
}

export function buildContactSubject({ name, interest }) {
  return `[Lumina] ${interest} inquiry from ${name}`;
}

export function buildContactText({ name, email, interest, message }) {
  const meta = INTEREST_META[interest] || { label: interest };
  return [
    "LUMINA FRAMEWORKS · INCOMING TRANSMISSION",
    "========================================",
    "",
    `Name:     ${name}`,
    `Email:    ${email}`,
    `Interest: ${meta.label}`,
    "",
    "Message",
    "-------",
    message,
    "",
    "Reply within 24 hours · Join Us for Free (https://t.me/+XZKbCeNqQs4zZjNl)"
  ].join("\n");
}

export function buildContactHtml({ name, email, interest, message }) {
  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(email);
  const safeMessage = escapeHtml(message).replace(/\r\n|\r|\n/g, "<br />");
  const meta = INTEREST_META[interest] || { label: interest, tone: "#1aa3ff" };
  const safeInterest = escapeHtml(meta.label);
  const tone = meta.tone;
  const ref = `LF-${Date.now().toString(36).toUpperCase()}`;
  const stamped = new Date().toLocaleString("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    dateStyle: "medium",
    timeStyle: "short"
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Lumina Transmission</title>
</head>
<body style="margin:0;padding:0;background:#03050a;color:#e8eef8;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
    New ${safeInterest} inquiry from ${safeName} · reply within 24 hours
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#03050a;background-image:radial-gradient(ellipse at 20% 0%,rgba(26,163,255,0.18),transparent 50%),radial-gradient(ellipse at 90% 10%,rgba(13,111,212,0.12),transparent 45%);padding:36px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:620px;border-collapse:separate;">
          <tr>
            <td style="padding:0 0 18px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="left" style="font-family:'IBM Plex Mono',Consolas,monospace;font-size:11px;letter-spacing:0.16em;color:#7dd9ff;text-transform:uppercase;">
                    // SECURE_CHANNEL
                  </td>
                  <td align="right" style="font-family:'IBM Plex Mono',Consolas,monospace;font-size:11px;letter-spacing:0.12em;color:#6a7388;">
                    ${escapeHtml(ref)}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="background:#0b0d14;border:1px solid rgba(26,163,255,0.28);border-radius:4px;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,0.45);">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="height:4px;background:linear-gradient(90deg,#062a5c 0%,#0d6fd4 42%,#1aa3ff 78%,#d9efff 100%);font-size:0;line-height:0;">&nbsp;</td>
                </tr>
                <tr>
                  <td style="padding:28px 28px 10px;">
                    <p style="margin:0 0 8px;font-family:'IBM Plex Mono',Consolas,monospace;font-size:11px;letter-spacing:0.14em;color:#7dd9ff;text-transform:uppercase;">
                      Incoming transmission
                    </p>
                    <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:28px;line-height:1.2;font-weight:700;color:#f4f7fc;">
                      Someone wants to build with Lumina
                    </h1>
                    <p style="margin:12px 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.55;color:#9aa3b8;">
                      A visitor reached out through the official site. Details locked below.
                    </p>
                  </td>
                </tr>

                <tr>
                  <td style="padding:18px 28px 8px;">
                    <span style="display:inline-block;padding:8px 12px;border:1px solid ${tone};background:rgba(26,163,255,0.08);font-family:'IBM Plex Mono',Consolas,monospace;font-size:12px;letter-spacing:0.08em;color:${tone};">
                      ${safeInterest}
                    </span>
                  </td>
                </tr>

                <tr>
                  <td style="padding:16px 28px 8px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;">
                      <tr>
                        <td width="50%" valign="top" style="padding:0 6px 12px 0;">
                          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#11131c;border:1px solid rgba(26,163,255,0.16);">
                            <tr>
                              <td style="padding:14px 16px;">
                                <p style="margin:0 0 6px;font-family:'IBM Plex Mono',Consolas,monospace;font-size:10px;letter-spacing:0.14em;color:#6a7388;text-transform:uppercase;">01 // Name</p>
                                <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:16px;font-weight:600;color:#f4f7fc;">${safeName}</p>
                              </td>
                            </tr>
                          </table>
                        </td>
                        <td width="50%" valign="top" style="padding:0 0 12px 6px;">
                          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#11131c;border:1px solid rgba(26,163,255,0.16);">
                            <tr>
                              <td style="padding:14px 16px;">
                                <p style="margin:0 0 6px;font-family:'IBM Plex Mono',Consolas,monospace;font-size:10px;letter-spacing:0.14em;color:#6a7388;text-transform:uppercase;">02 // Email</p>
                                <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;font-weight:600;">
                                  <a href="mailto:${safeEmail}" style="color:#7dd9ff;text-decoration:none;">${safeEmail}</a>
                                </p>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <tr>
                  <td style="padding:4px 28px 8px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0f1522;border:1px solid rgba(26,163,255,0.22);border-left:3px solid #1aa3ff;">
                      <tr>
                        <td style="padding:18px 18px 20px;">
                          <p style="margin:0 0 10px;font-family:'IBM Plex Mono',Consolas,monospace;font-size:10px;letter-spacing:0.14em;color:#7dd9ff;text-transform:uppercase;">04 // Message</p>
                          <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:1.7;color:#d7deea;">
                            ${safeMessage}
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <tr>
                  <td style="padding:22px 28px 28px;" align="left">
                    <a href="mailto:${safeEmail}?subject=${encodeURIComponent(`Re: Lumina ${interest} inquiry`)}"
                       style="display:inline-block;padding:14px 22px;background:linear-gradient(120deg,#0d6fd4,#1aa3ff);color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;font-weight:700;text-decoration:none;border-radius:2px;letter-spacing:0.02em;">
                      Reply to ${safeName} →
                    </a>
                    <p style="margin:16px 0 0;font-family:'IBM Plex Mono',Consolas,monospace;font-size:11px;color:#6a7388;">
                      Received ${escapeHtml(stamped)} · MYT · response window 24h
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:20px 8px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="left" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:12px;color:#6a7388;">
                    Lumina Frameworks · Build smarter with AI
                  </td>
                  <td align="right" style="font-family:'IBM Plex Mono',Consolas,monospace;font-size:11px;">
                    <a href="https://t.me/+XZKbCeNqQs4zZjNl" style="color:#1aa3ff;text-decoration:none;">Join Us for Free</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function sendContactEmail(env, payload) {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    const err = new Error("Missing RESEND_API_KEY. Contact email is not configured.");
    err.status = 500;
    throw err;
  }

  const data = normalizeContactPayload(payload);
  const validationError = validateContactPayload(data);
  if (validationError) {
    const err = new Error(validationError);
    err.status = 400;
    throw err;
  }

  const from = String(
    env.CONTACT_FROM || "Lumina Frameworks <hello@lumina-frameworks.com>"
  ).trim();
  if (!/lumina-frameworks\.com/i.test(from)) {
    const err = new Error(
      `CONTACT_FROM must use @lumina-frameworks.com. Got: ${from}`
    );
    err.status = 500;
    throw err;
  }
  const to = CONTACT_RECIPIENTS;
  const subject = buildContactSubject(data);
  const html = buildContactHtml(data);
  const text = buildContactText(data);

  const upstream = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from,
      to,
      reply_to: data.email,
      subject,
      html,
      text
    })
  }).catch((fetchErr) => {
    const err = new Error(`Could not reach Resend: ${String(fetchErr?.message || fetchErr)}`);
    err.status = 500;
    throw err;
  });

  const detail = await upstream.text().catch(() => "");
  if (!upstream.ok) {
    let resendMessage = "Failed to deliver transmission.";
    try {
      const parsed = JSON.parse(detail || "{}");
      if (parsed?.message) resendMessage = String(parsed.message);
    } catch {
      /* keep default */
    }
    const err = new Error(`${resendMessage} [from=${from}]`);
    // Avoid HTTP 502: Cloudflare proxies rewrite origin 502s into a generic gateway page.
    err.status = 500;
    err.detail = detail.slice(0, 800);
    throw err;
  }

  let parsed = {};
  try {
    parsed = JSON.parse(detail || "{}");
  } catch {
    parsed = {};
  }

  return { ok: true, id: parsed.id || null, to };
}
