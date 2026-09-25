/**
 * End-to-end tests for the API layer.
 * Run: node tests/api.test.mjs
 *
 * There is no Wrangler here on purpose. D1 is SQLite, SQLite ships with Node,
 * so we can run the real db/schema.sql, the real seed, and the real route
 * handlers against an in-memory database. That covers the SQL, the bind order,
 * the column names, and the auth guard without needing a Cloudflare account.
 *
 * What this does NOT cover: the live Google handshake and real R2 behaviour.
 */
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { signSession, SESSION_COOKIE } from "../functions/_shared/auth.js";
import { onRequestGet as publicProjects } from "../functions/api/projects.js";
import { onRequestGet as adminList, onRequestPost as adminCreate } from "../functions/api/admin/projects/index.js";
import { onRequestPut as adminUpdate, onRequestDelete as adminDelete } from "../functions/api/admin/projects/[slug].js";
import { onRequestPost as adminUpload } from "../functions/api/admin/upload.js";
import { onRequestGet as authMe } from "../functions/api/auth/me.js";
import * as contactModule from "../functions/api/contact.js";
import { onRequestPost as contactPost } from "../functions/api/contact.js";
import { validateContactPayload } from "../functions/_shared/contact-email.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/* ---------- a minimal D1-shaped wrapper over node:sqlite ---------- */

function makeD1(sqlite) {
  class Statement {
    constructor(sql, params = []) {
      this.sql = sql;
      this.params = params;
    }
    bind(...params) {
      return new Statement(this.sql, params);
    }
    all() {
      return { results: sqlite.prepare(this.sql).all(...this.params).map((row) => ({ ...row })) };
    }
    first() {
      const row = sqlite.prepare(this.sql).get(...this.params);
      return row ? { ...row } : null;
    }
    run() {
      sqlite.prepare(this.sql).run(...this.params);
      return { success: true };
    }
  }
  return { prepare: (sql) => new Statement(sql) };
}

function fakeR2() {
  const objects = new Map();
  return {
    objects,
    async put(key, value, options) {
      objects.set(key, { value, options });
    }
  };
}

/* ---------- fixtures ---------- */

const ADMIN_EMAIL = "amirhafizi443@gmail.com";
const AUTH_SECRET = "test-secret-for-api-tests-only";
const BASE = "https://lumina-frameworks.com";

let sqlite;
let env;

before(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec(fs.readFileSync(path.join(ROOT, "db", "schema.sql"), "utf8"));
  sqlite.exec(fs.readFileSync(path.join(ROOT, "db", "seed.sql"), "utf8"));
  env = {
    DB: makeD1(sqlite),
    MEDIA: fakeR2(),
    MEDIA_BASE_URL: "https://media.lumina-frameworks.com",
    AUTH_SECRET,
    ADMIN_EMAILS: `${ADMIN_EMAIL},aliffprime3@gmail.com`,
    GOOGLE_CLIENT_ID: "test-client-id.apps.googleusercontent.com"
  };
});

async function sessionCookieFor(email, secret = AUTH_SECRET) {
  const now = Math.floor(Date.now() / 1000);
  const sid = crypto.randomUUID();
  // getSession now requires a live row in `sessions`, so every test session has
  // to be opened the way the real sign-in flow opens one.
  sqlite
    .prepare("INSERT INTO sessions (id, email, role) VALUES (?, ?, 'owner')")
    .run(sid, email);
  const token = await signSession({ sub: "1", email, sid, iat: now, exp: now + 3600 }, secret);
  return `${SESSION_COOKIE}=${token}`;
}

function req(method, url, { cookie, body, headers } = {}) {
  const init = { method, headers: { ...headers } };
  if (cookie) init.headers.Cookie = cookie;
  if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  return new Request(BASE + url, init);
}

const VALID_PROJECT = {
  title: "Nightshift",
  symbol: "NS",
  category: "Platform",
  year: 2026,
  tagline: "OVERNIGHT OPS",
  blurb: "Scheduled agent runs that report in before the team wakes up.",
  stack: ["Cron", "Agents"],
  tags: ["ops", "Automation"],
  url: "https://example.com/nightshift",
  featured: true,
  published: true,
  sort_order: 11
};

/* ---------- schema + seed ---------- */

describe("db/schema.sql + db/seed.sql", () => {
  test("creates the projects table with every column the code queries", () => {
    const columns = sqlite.prepare("PRAGMA table_info(projects)").all().map((c) => c.name);
    for (const expected of [
      "slug", "title", "symbol", "category", "year", "image_url", "blurb",
      "tagline", "stack", "tags", "url", "featured", "published", "sort_order",
      "created_at", "updated_at"
    ]) {
      assert.ok(columns.includes(expected), `missing column: ${expected}`);
    }
  });

  test("seeds the original 10 projects", () => {
    const { count } = sqlite.prepare("SELECT COUNT(*) AS count FROM projects").get();
    assert.equal(count, 10);
  });

  test("is idempotent: re-running the seed does not duplicate rows", () => {
    sqlite.exec(fs.readFileSync(path.join(ROOT, "db", "seed.sql"), "utf8"));
    const { count } = sqlite.prepare("SELECT COUNT(*) AS count FROM projects").get();
    assert.equal(count, 10);
  });

  test("keeps the 5 carousel projects in their original order", () => {
    const rows = sqlite
      .prepare("SELECT title FROM projects WHERE featured = 1 ORDER BY sort_order ASC")
      .all()
      .map((r) => r.title);
    assert.deepEqual(rows, [
      "Write Genius",
      "A.K.A.R.I.",
      "Lumina Frameworks",
      "Arefa Hermes",
      "Hermes Desk"
    ]);
  });

  test("creates the console tables the roster, sessions, and audit log need", () => {
    for (const [table, columns] of Object.entries({
      admins: ["email", "role", "status", "note", "added_by", "last_seen", "login_count"],
      sessions: ["id", "email", "role", "login_at", "last_seen", "user_agent", "ip_hash", "status"],
      audit_log: [
        "actor", "actor_role", "action", "status", "entity", "entity_id", "summary",
        "method", "path", "ip_hash", "country", "user_agent", "device", "browser", "os", "details"
      ]
    })) {
      const found = sqlite.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
      for (const column of columns) {
        assert.ok(found.includes(column), `${table} is missing ${column}`);
      }
    }
  });

  test("bootstraps the two founders as owners, once", () => {
    // node:sqlite hands back null-prototype rows, so map them to plain objects.
    const rows = sqlite
      .prepare("SELECT email, role, status FROM admins ORDER BY email")
      .all()
      .map((row) => ({ email: row.email, role: row.role, status: row.status }));
    assert.deepEqual(rows, [
      { email: "aliffprime3@gmail.com", role: "owner", status: "active" },
      { email: "amirhafizi443@gmail.com", role: "owner", status: "active" }
    ]);

    // Re-running the schema must not duplicate or resurrect anything.
    sqlite.exec(fs.readFileSync(path.join(ROOT, "db", "schema.sql"), "utf8"));
    const { count } = sqlite.prepare("SELECT COUNT(*) AS count FROM admins").get();
    assert.equal(count, 2);
  });
});

/* ---------- public feed ---------- */

describe("GET /api/projects", () => {
  test("returns published projects in the front-end shape", async () => {
    const response = await publicProjects({ request: req("GET", "/api/projects"), env });
    assert.equal(response.status, 200);
    const { projects } = await response.json();
    assert.equal(projects.length, 10);
    const akari = projects.find((p) => p.id === "akari");
    assert.equal(akari.image, "./assets/project-akari.jpg");
    assert.deepEqual(akari.stack, ["OpenRouter", "Streaming chat", "Cloudflare Pages"]);
    assert.equal(akari.tagline, "PC BUILD COACH");
  });

  test("filters to featured projects for the home carousel", async () => {
    const response = await publicProjects({ request: req("GET", "/api/projects?featured=1"), env });
    const { projects } = await response.json();
    assert.equal(projects.length, 5);
    assert.ok(projects.every((p) => p.featured));
  });

  test("hides unpublished projects", async () => {
    sqlite.prepare("UPDATE projects SET published = 0 WHERE slug = ?").run("roi-radar");
    const response = await publicProjects({ request: req("GET", "/api/projects"), env });
    const { projects } = await response.json();
    assert.equal(projects.length, 9);
    assert.ok(!projects.some((p) => p.id === "roi-radar"));
    sqlite.prepare("UPDATE projects SET published = 1 WHERE slug = ?").run("roi-radar");
  });
});

/* ---------- auth guard ---------- */

describe("admin auth guard", () => {
  test("rejects an anonymous request", async () => {
    const response = await adminList({ request: req("GET", "/api/admin/projects"), env });
    assert.equal(response.status, 401);
  });

  test("accepts an allowlisted session", async () => {
    const response = await adminList({
      request: req("GET", "/api/admin/projects", { cookie: await sessionCookieFor(ADMIN_EMAIL) }),
      env
    });
    assert.equal(response.status, 200);
    const { projects } = await response.json();
    assert.equal(projects.length, 10, "admin list includes drafts");
  });

  test("rejects a session for an email that is not on the allowlist", async () => {
    const response = await adminList({
      request: req("GET", "/api/admin/projects", { cookie: await sessionCookieFor("attacker@example.com") }),
      env
    });
    assert.equal(response.status, 401, "allowlist is re-checked on every request");
  });

  test("rejects a session signed with the wrong secret", async () => {
    const response = await adminList({
      request: req("GET", "/api/admin/projects", { cookie: await sessionCookieFor(ADMIN_EMAIL, "wrong-secret") }),
      env
    });
    assert.equal(response.status, 401);
  });

  test("rejects a cross-origin admin request", async () => {
    const response = await adminList({
      request: req("GET", "/api/admin/projects", {
        cookie: await sessionCookieFor(ADMIN_EMAIL),
        headers: { Origin: "https://evil.example" }
      }),
      env
    });
    assert.equal(response.status, 403);
  });

  test("accepts a same-origin admin request", async () => {
    const response = await adminList({
      request: req("GET", "/api/admin/projects", {
        cookie: await sessionCookieFor(ADMIN_EMAIL),
        headers: { Origin: BASE }
      }),
      env
    });
    assert.equal(response.status, 200);
  });

  test("GET /api/auth/me reports the session", async () => {
    const anonymous = await authMe({ request: req("GET", "/api/auth/me"), env });
    assert.deepEqual(await anonymous.json(), { authenticated: false });

    const signedIn = await authMe({
      request: req("GET", "/api/auth/me", { cookie: await sessionCookieFor(ADMIN_EMAIL) }),
      env
    });
    const body = await signedIn.json();
    assert.equal(body.authenticated, true);
    assert.equal(body.email, ADMIN_EMAIL);
  });
});

/* ---------- CRUD ---------- */

/* ---------- contact form abuse guards ---------- */

describe("contact form", () => {
  const good = { name: "Amir", email: "amirhafizi443@gmail.com", interest: "DIY", message: "Hello." };

  test("accepts a normal address", () => {
    assert.equal(validateContactPayload(good), null);
  });

  test("rejects a one-character TLD that Resend would refuse with a 422", () => {
    // This is the case that used to slip through and surface as a confusing 500.
    assert.equal(validateContactPayload({ ...good, email: "x@y.z" }), "A valid email is required.");
    assert.equal(validateContactPayload({ ...good, email: "a@b.c" }), "A valid email is required.");
  });

  test("still rejects addresses with no domain or no TLD", () => {
    for (const email of ["nope", "nope@", "@nope.com", "nope@localhost", "a b@c.com"]) {
      assert.equal(validateContactPayload({ ...good, email }), "A valid email is required.", email);
    }
  });

  test("accepts plus-addressing and multi-part TLDs", () => {
    assert.equal(validateContactPayload({ ...good, email: "amir+cms@example.co.uk" }), null);
  });

  test("sends no CORS wildcard, so a foreign site cannot post the form", async () => {
    const response = await contactPost({
      request: req("POST", "/api/contact", {
        body: { name: "", email: "", interest: "", message: "" }
      }),
      env: { ...env, RESEND_API_KEY: "re_test_key_not_used" }
    });
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
  });

  test("exposes no OPTIONS handler", () => {
    assert.equal(
      contactModule.onRequestOptions,
      undefined,
      "a preflight handler would re-open cross-origin posting"
    );
  });
});

describe("project CRUD", () => {
  let cookie;
  let slug;

  before(async () => {
    cookie = await sessionCookieFor(ADMIN_EMAIL);
  });

  test("creates a project and derives a slug", async () => {
    const response = await adminCreate({
      request: req("POST", "/api/admin/projects", { cookie, body: VALID_PROJECT }),
      env
    });
    assert.equal(response.status, 201);
    const { project } = await response.json();
    assert.equal(project.slug, "nightshift");
    assert.equal(project.published, true);
    assert.equal(project.featured, true);
    slug = project.slug;
  });

  test("the new project is immediately visible on the public feed", async () => {
    const response = await publicProjects({ request: req("GET", "/api/projects"), env });
    const { projects } = await response.json();
    assert.equal(projects.length, 11);
    assert.ok(projects.some((p) => p.id === "nightshift"));
  });

  test("rejects an invalid payload without writing", async () => {
    const response = await adminCreate({
      request: req("POST", "/api/admin/projects", { cookie, body: { ...VALID_PROJECT, url: "javascript:alert(1)" } }),
      env
    });
    assert.equal(response.status, 400);
    const { count } = sqlite.prepare("SELECT COUNT(*) AS count FROM projects").get();
    assert.equal(count, 11, "nothing was inserted");
  });

  test("slug collisions get a suffix", async () => {
    const response = await adminCreate({
      request: req("POST", "/api/admin/projects", { cookie, body: { ...VALID_PROJECT, title: "Nightshift" } }),
      env
    });
    const { project } = await response.json();
    assert.equal(project.slug, "nightshift-2");
    sqlite.prepare("DELETE FROM projects WHERE slug = ?").run("nightshift-2");
  });

  test("updates a project", async () => {
    const response = await adminUpdate({
      request: req("PUT", `/api/admin/projects/${slug}`, {
        cookie,
        body: { ...VALID_PROJECT, title: "Nightshift Ops", blurb: "Rewritten.", published: false }
      }),
      env,
      params: { slug }
    });
    assert.equal(response.status, 200);
    const { project } = await response.json();
    assert.equal(project.title, "Nightshift Ops");
    assert.equal(project.blurb, "Rewritten.");
    assert.equal(project.published, false);
    // datetime('now') is second-resolution, so it can legitimately equal
    // created_at for a same-second update. Assert it is populated and sane.
    assert.match(project.updatedAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    assert.ok(project.updatedAt >= project.createdAt);
  });

  test("unpublishing removes it from the public feed but keeps the row", async () => {
    const response = await publicProjects({ request: req("GET", "/api/projects"), env });
    const { projects } = await response.json();
    assert.ok(!projects.some((p) => p.id === slug));
    const { count } = sqlite.prepare("SELECT COUNT(*) AS count FROM projects WHERE slug = ?").get(slug);
    assert.equal(count, 1);
  });

  test("soft delete unpublishes", async () => {
    const response = await adminDelete({
      request: req("DELETE", `/api/admin/projects/${slug}`, { cookie }),
      env,
      params: { slug }
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).deleted, "soft");
    const row = sqlite.prepare("SELECT published FROM projects WHERE slug = ?").get(slug);
    assert.equal(row.published, 0);
  });

  test("hard delete removes the row", async () => {
    const response = await adminDelete({
      request: req("DELETE", `/api/admin/projects/${slug}?hard=1`, { cookie }),
      env,
      params: { slug }
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).deleted, "hard");
    const row = sqlite.prepare("SELECT slug FROM projects WHERE slug = ?").get(slug);
    assert.equal(row, undefined);
  });

  test("updating a missing project is a 404", async () => {
    const response = await adminUpdate({
      request: req("PUT", "/api/admin/projects/ghost", { cookie, body: VALID_PROJECT }),
      env,
      params: { slug: "ghost" }
    });
    assert.equal(response.status, 404);
  });

  test("a viewer may read the list but not write to it", async () => {
    sqlite
      .prepare("INSERT INTO admins (email, role, status) VALUES (?, 'viewer', 'active')")
      .run("viewer@example.com");
    const viewerCookie = await sessionCookieFor("viewer@example.com");

    const read = await adminList({ request: req("GET", "/api/admin/projects", { cookie: viewerCookie }), env });
    assert.equal(read.status, 200);

    const write = await adminCreate({
      request: req("POST", "/api/admin/projects", { cookie: viewerCookie, body: VALID_PROJECT }),
      env
    });
    assert.equal(write.status, 403, "role gate rejects the write for a viewer");
    assert.equal((await write.json()).role, "viewer");
  });
});

/* ---------- upload ---------- */

describe("POST /api/admin/upload", () => {
  let cookie;

  before(async () => {
    cookie = await sessionCookieFor(ADMIN_EMAIL);
  });

  function pngFile(bytes = 32, name = "shot.png", type = "image/png") {
    const buffer = new Uint8Array(bytes);
    buffer.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
    return new File([buffer], name, { type });
  }

  function uploadRequest(file, { authenticated = true } = {}) {
    const body = new FormData();
    body.append("file", file);
    const headers = {};
    if (authenticated) headers.Cookie = cookie;
    return new Request(`${BASE}/api/admin/upload`, { method: "POST", headers, body });
  }

  test("stores a PNG in R2 and returns a public URL", async () => {
    const response = await adminUpload({ request: uploadRequest(pngFile()), env });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.match(body.url, /^https:\/\/media\.lumina-frameworks\.com\/projects\/shot-[0-9a-f]{8}\.png$/);
    assert.equal(body.type, "image/png");
    assert.ok(env.MEDIA.objects.has(body.key), "object landed in the bucket");
  });

  test("rejects an unauthenticated upload", async () => {
    const response = await adminUpload({ request: uploadRequest(pngFile(), { authenticated: false }), env });
    assert.equal(response.status, 401);
  });

  test("rejects a file whose bytes are not an image, even with a .png name", async () => {
    const html = new File([new TextEncoder().encode("<html><script>alert(1)</script></html>")], "evil.png", {
      type: "image/png"
    });
    const response = await adminUpload({ request: uploadRequest(html), env });
    assert.equal(response.status, 415);
  });

  test("rejects an oversized image", async () => {
    const response = await adminUpload({ request: uploadRequest(pngFile(5 * 1024 * 1024 + 64)), env });
    assert.equal(response.status, 413);
  });
});
