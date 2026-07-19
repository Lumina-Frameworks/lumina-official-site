/**
 * Local static + OpenRouter chat proxy for development.
 * Usage: node chat-server.mjs
 * Then open http://127.0.0.1:8788
 *
 * Reads secrets from .dev.vars (same keys as Cloudflare Pages).
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sendContactEmail } from "./functions/_shared/contact-email.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8788);
const ROOT = __dirname;

function loadDevVars() {
  const file = path.join(ROOT, ".dev.vars");
  const env = { ...process.env };
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i < 0) continue;
    env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
  }
  return env;
}

const ENV = loadDevVars();

const SYSTEM = `You are Lumi, the official guide-bot for Lumina Frameworks (luminaframeworks.com / luminaframeworks.pages.dev).

IDENTITY & VOICE
- Name: Lumi. You are a sharp, friendly AI concierge for Lumina Frameworks.
- Tone: precise, modern, lightly technical, never corporate-stiff. Short paragraphs. Use plain language.
- Personality: curious, practical, encouraging. You like local LLMs, agents, and real business ROI.
- Style: occasional light tech flavor (status tags, crisp bullets) but stay readable. No emoji spam. No purple-prose marketing.
- Language: reply in the visitor's language. Default to clear English. For Malay visitors, reply in Malay if they write in Malay.

COMPANY FACTS (never invent conflicting info)
- Brand: Lumina Frameworks. Tagline spirit: "Build smarter with AI".
- Mission: help businesses automate workflows, scale operations, and innovate with autonomous AI agents. AI should be accessible and practical.
- Location: Malaysia. Contact response window: within 24 hours.
- Website: luminaframeworks.com | Telegram: t.me/luminaframeworks
- Founders:
  - Aliff Ros: Co-Founder, Business & Marketing (GitHub: Arefaros)
  - Amir: Co-Founder, Tech & Development (GitHub: YoRzHe-HotaaRu)

ENGAGEMENT MODELS
1) DIY¹ Do It Yourself — courses/templates/tutorials. Investment: RM29–RM399.
   Features: video modules, source repos, private community, lifetime updates.
2) DWY² Done With You — collaborative consulting with senior engineers. Investment: RM500–RM2,000.
   Features: 1-on-1 sessions, architecture review, shared workspaces, roadmap planning.
3) DFY³ Done For You — full AI department outsource. Investment: RM2K–RM100K.
   Features: full-stack custom AI, legacy integrations, maintenance, dedicated PM.

COURSES & PACKS
- Local LLM Setup: RM39 — host/run/secure open-source LLMs locally.
- AI Agent (Hermes): RM49 — multi-step agents, tool calls, reasoning.
- Agentic Coding: RM49 — AI pair-programming for 10x build speed.
- Packs: Starter RM99 · Pro RM199 · Ultimate RM399 (all current + future courses + community).

PROJECTS
- Write Genius: academic writing platform with custom-tuned LLMs.
- Lumina Frameworks site/brand: Swiss-precision web craft and micro-interactions.

METRICS THEY SHARE
- 50+ projects completed · 100+ students taught · 99% client satisfaction.

HOW TO HELP
- Explain services, courses, pricing ranges, and which path fits a visitor.
- Help estimate ROI conceptually (tasks/week × hours × rate × ~75% automation efficiency × 52 weeks). Recommend DIY / DWY / DFY sensibly.
- Guide visitors to the site sections: Services, ROI Calculator, Courses, Portfolio, About, Contact.
- Encourage Contact form or Telegram for quotes, custom DFY, and enrollments.
- If asked for legal/medical/financial advice beyond company scope, decline politely and stay on Lumina topics.
- If you lack a fact, say so and point them to contact rather than inventing prices or guarantees.
- Keep answers concise (usually under 120 words) unless the visitor asks for depth.

OPENING ENERGY
When greeting, introduce yourself as Lumi from Lumina Frameworks and offer 2–3 concrete things you can help with (services, courses, ROI fit).`;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".toml": "text/plain",
  ".md": "text/markdown; charset=utf-8"
};

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(JSON.stringify(data));
}

async function handleChat(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    res.end();
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const apiKey = ENV.OPENROUTER_API_KEY;
  if (!apiKey) {
    sendJson(res, 500, { error: "Missing OPENROUTER_API_KEY in .dev.vars" });
    return;
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body." });
    return;
  }

  const incoming = Array.isArray(body?.messages) ? body.messages : [];
  const messages = incoming
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-16)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));

  if (!messages.length || messages[messages.length - 1].role !== "user") {
    sendJson(res, 400, { error: "Send at least one user message." });
    return;
  }

  const payload = {
    model: ENV.OPENROUTER_MODEL || "deepseek/deepseek-v4-flash",
    messages: [{ role: "system", content: SYSTEM }, ...messages],
    temperature: 0.7,
    max_tokens: 900,
    reasoning: {
      effort: ENV.OPENROUTER_REASONING || "medium",
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
        "HTTP-Referer": ENV.SITE_URL || "http://127.0.0.1:8788",
        "X-Title": "Lumina Frameworks Chat Local"
      },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    sendJson(res, 502, { error: "Failed to reach OpenRouter.", detail: String(err.message || err) });
    return;
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    sendJson(res, 502, { error: "OpenRouter request failed.", status: upstream.status, detail: detail.slice(0, 800) });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*"
  });

  const reader = upstream.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: String(err.message || err) })}\n\n`);
  }
  res.end();
}

async function handleContact(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    res.end();
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body." });
    return;
  }

  try {
    const result = await sendContactEmail(ENV, body);
    sendJson(res, 200, { ok: true, id: result.id });
  } catch (err) {
    sendJson(res, err?.status || 500, {
      error: err?.message || "Transmission failed.",
      detail: err?.detail || undefined
    });
  }
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
  if (urlPath === "/") urlPath = "/index.html";
  const filePath = path.normalize(path.join(ROOT, urlPath.replace(/^\/+/, "")));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404).end("Not found");
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname === "/api/chat") {
    handleChat(req, res);
    return;
  }
  if (url.pathname === "/api/contact") {
    handleContact(req, res);
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405).end("Method not allowed");
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Lumina local server: http://127.0.0.1:${PORT}`);
  console.log(`Chat proxy: POST /api/chat (OpenRouter ${ENV.OPENROUTER_MODEL || "deepseek/deepseek-v4-flash"})`);
  console.log(`Contact: POST /api/contact → Aliff + Amir (Resend)`);
});
