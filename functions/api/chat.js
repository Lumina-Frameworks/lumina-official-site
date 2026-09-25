/**
 * Cloudflare Pages Function: OpenRouter chat proxy
 * Keeps the API key server-side. Set OPENROUTER_API_KEY in:
 * - Cloudflare Pages > Settings > Environment variables
 * - local: .dev.vars (never commit)
 *
 * The system prompt lives in ../_shared/lumi-prompt.js and its PROJECTS section
 * is generated from D1, so Lumi always describes the current portfolio.
 */
import { buildSystemPrompt } from "../_shared/lumi-prompt.js";
import { listProjects } from "../_shared/projects.js";

const PROMPT_TTL_MS = 60_000;
let promptCache = { text: null, expiresAt: 0 };

async function systemPrompt(env) {
  const now = Date.now();
  if (promptCache.text && promptCache.expiresAt > now) return promptCache.text;

  let projects = [];
  try {
    if (env.DB) projects = await listProjects(env);
  } catch (err) {
    // A chat request should still work if the portfolio query fails.
    console.error("[chat] could not load projects:", err?.message || err);
  }

  const text = buildSystemPrompt(projects);
  promptCache = { text, expiresAt: now + PROMPT_TTL_MS };
  return text;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const apiKey = env.OPENROUTER_API_KEY;

  if (!apiKey) {
    return json({ error: "Chat is not configured. Missing OPENROUTER_API_KEY." }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const incoming = Array.isArray(body?.messages) ? body.messages : [];
  const messages = incoming
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-16)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));

  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return json({ error: "Send at least one user message." }, 400);
  }

  const payload = {
    model: env.OPENROUTER_MODEL || "deepseek/deepseek-v4-flash",
    messages: [{ role: "system", content: await systemPrompt(env) }, ...messages],
    temperature: 0.7,
    max_tokens: 900,
    reasoning: {
      effort: env.OPENROUTER_REASONING || "medium",
      exclude: true
    },
    stream: true
  };

  let upstream;
  try {
    upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": env.SITE_URL || "https://lumina-frameworks.com",
        "X-Title": "Lumina Frameworks Chat"
      },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    return json({ error: "Failed to reach OpenRouter.", detail: String(err?.message || err) }, 502);
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    return json({ error: "OpenRouter request failed.", status: upstream.status, detail: detail.slice(0, 800) }, 502);
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}

function json(data, status = 200) {
  // Deliberately no Access-Control-Allow-Origin. A wildcard here let any
  // website spend this project's OpenRouter credits. The chat widget is
  // same-origin, so no CORS headers are needed.
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
