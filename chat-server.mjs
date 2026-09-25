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
import { buildSystemPrompt } from "./functions/_shared/lumi-prompt.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8788);
const APP_ROOT = __dirname;
const ROOT = path.join(__dirname, "public");

function loadDevVars() {
  const file = path.join(APP_ROOT, ".dev.vars");
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

const PROMPT_TTL_MS = 60_000;
let promptCache = { text: null, expiresAt: 0 };

/**
 * Lumi's prompt is shared with the production Function. The PROJECTS section is
 * pulled from the live portfolio so local Lumi matches production.
 */
async function systemPrompt() {
  const now = Date.now();
  if (promptCache.text && promptCache.expiresAt > now) return promptCache.text;

  let projects = [];
  try {
    const response = await fetch(`${ENV.SITE_URL || "https://lumina-frameworks.com"}/api/projects`, {
      signal: AbortSignal.timeout(2500)
    });
    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data?.projects)) projects = data.projects;
    }
  } catch (err) {
    console.warn("[chat] portfolio unavailable, using built-in list:", err.message);
  }

  const text = buildSystemPrompt(projects);
  promptCache = { text, expiresAt: now + PROMPT_TTL_MS };
  return text;
}

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
    messages: [{ role: "system", content: await systemPrompt() }, ...messages],
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
