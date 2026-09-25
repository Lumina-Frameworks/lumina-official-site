/**
 * Tests for the public site's client-side rendering guards.
 * Run: node tests/frontend.test.mjs
 *
 * These are the guards that actually protect visitors: the server validates what
 * an admin can save, but every project field is interpolated into innerHTML on
 * the public pages. If escapeHtml or safeImage regress, stored XSS ships.
 */
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

let feed;
let admin;

before(async () => {
  // The modules assign to globalThis when there is no window.
  await import("../public/assets/projects-feed.js");
  await import("../public/assets/admin-utils.js");
  feed = globalThis.LuminaProjects;
  admin = globalThis.LuminaAdmin;
});

describe("admin utils", () => {
  test("role checks follow the hierarchy: viewer < admin < owner", () => {
    assert.equal(admin.can("viewer", "viewer"), true);
    assert.equal(admin.can("viewer", "admin"), false);
    assert.equal(admin.can("admin", "admin"), true);
    assert.equal(admin.can("admin", "owner"), false);
    assert.equal(admin.can("owner", "owner"), true);
    assert.equal(admin.can(undefined, "viewer"), false, "no session means no access");
    assert.equal(admin.can("superuser", "viewer"), false, "an unknown role is not a role");
  });

  test("initials come from the name, or the local part of an email", () => {
    assert.equal(admin.initials("amirhafizi443@gmail.com"), "AM");
    assert.equal(admin.initials("Aliff Ros"), "AR");
    assert.equal(admin.initials("aliff"), "AL");
    assert.equal(admin.initials(""), "--");
    assert.equal(admin.initials(null), "--");
  });

  test("relative time handles the SQLite timestamp format", () => {
    const now = new Date("2026-03-01T12:00:00Z");
    assert.equal(admin.relativeTime("2026-03-01 11:59:30", now), "just now");
    assert.equal(admin.relativeTime("2026-03-01 11:30:00", now), "30m ago");
    assert.equal(admin.relativeTime("2026-03-01 06:00:00", now), "6h ago");
    assert.equal(admin.relativeTime("2026-02-27 12:00:00", now), "2d ago");
    assert.equal(admin.relativeTime("2026-02-20 12:00:00", now), "1w ago");
    // 59 days: past the 4-week step, so it reads in months.
    assert.equal(admin.relativeTime("2026-01-01 12:00:00", now), "1mo ago");
    assert.equal(admin.relativeTime("2024-03-01 12:00:00", now), "2y ago");
    assert.equal(admin.relativeTime("", now), "--");
    assert.equal(admin.relativeTime("not a date", now), "--");
    // A clock skewed a few seconds ahead must not render "-3s ago".
    assert.equal(admin.relativeTime("2026-03-01 12:00:05", now), "just now");
  });

  test("audit filters serialise to a query string and drop empties", () => {
    assert.equal(
      admin.buildQuery({ limit: 50, offset: 0, actor: "", action: "project.", q: "", status: null }),
      "?limit=50&offset=0&action=project."
    );
    assert.equal(admin.buildQuery({}), "");
    assert.equal(
      admin.buildQuery({ q: "a b&c", since: "2026-01-01" }),
      "?q=a+b%26c&since=2026-01-01"
    );
  });

  test("action names render as readable labels", () => {
    assert.equal(admin.actionLabel("project.update"), "Project · Update");
    assert.equal(admin.actionLabel("auth.login"), "Auth · Login");
    assert.equal(admin.actionLabel(""), "");
  });

  test("CSV export quotes separators and escapes inner quotes", () => {
    const csv = admin.toCsv(["a", "b"], [
      { a: 1, b: "plain" },
      { a: 2, b: 'has "quotes", and a comma' },
      { a: 3, b: null }
    ]);
    assert.equal(
      csv,
      'a,b\r\n1,plain\r\n2,"has ""quotes"", and a comma"\r\n3,'
    );
  });

  test("sprite helpers pick a glyph per device and role", () => {
    assert.equal(admin.deviceIcon("Mobile · Safari 17"), "#i-mobile");
    assert.equal(admin.deviceIcon("Tablet"), "#i-mobile");
    assert.equal(admin.deviceIcon("Desktop · Chrome 131"), "#i-monitor");
    assert.equal(admin.deviceIcon(null), "#i-monitor");
    assert.equal(admin.roleIcon("owner"), "#i-shield");
    assert.equal(admin.roleIcon("admin"), "#i-key");
    assert.equal(admin.roleIcon("viewer"), "#i-users");
  });

  test("byte sizes read the way the upload toast shows them", () => {
    assert.equal(admin.formatBytes(512), "512 B");
    assert.equal(admin.formatBytes(2048), "2.0 KB");
    assert.equal(admin.formatBytes(5 * 1024 * 1024), "5.0 MB");
  });

  test("URL and image guards match the public site's", () => {
    assert.equal(admin.escapeHtml("<b>"), "&lt;b&gt;");
    assert.equal(admin.safeUrl("javascript:alert(1)"), "");
    assert.equal(admin.safeUrl("https://ok.example"), "https://ok.example");
    assert.equal(admin.safeImage("./assets/WG.png"), "./assets/WG.png");
    assert.equal(admin.safeImage('x" onerror="alert(1)'), "");
  });
});

describe("escapeHtml", () => {
  test("neutralises an img onerror payload", () => {
    const out = feed.escapeHtml('<img src=x onerror="alert(1)">');
    assert.equal(out, "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    assert.ok(!out.includes("<"), "no raw angle bracket survives");
  });

  test("neutralises a script tag and single-quote attribute breakout", () => {
    assert.equal(feed.escapeHtml("<script>alert(1)</script>"), "&lt;script&gt;alert(1)&lt;/script&gt;");
    assert.equal(feed.escapeHtml("' onmouseover='alert(1)"), "&#39; onmouseover=&#39;alert(1)");
  });

  test("escapes ampersands so entities cannot be smuggled through", () => {
    assert.equal(feed.escapeHtml("&lt;script&gt;"), "&amp;lt;script&amp;gt;");
  });

  test("handles null, undefined and numbers without throwing", () => {
    assert.equal(feed.escapeHtml(null), "");
    assert.equal(feed.escapeHtml(undefined), "");
    assert.equal(feed.escapeHtml(2026), "2026");
  });

  test("leaves ordinary project copy untouched", () => {
    const copy = "Advanced Knowledgeable Assembly Rig Instructor. RM budgets, first-boot help.";
    assert.equal(feed.escapeHtml(copy), copy);
  });
});

describe("safeUrl", () => {
  test("allows http and https", () => {
    assert.equal(feed.safeUrl("https://example.com/x"), "https://example.com/x");
    assert.equal(feed.safeUrl("http://example.com/"), "http://example.com/");
  });

  test("rejects javascript: and data: URLs", () => {
    assert.equal(feed.safeUrl("javascript:alert(1)"), "");
    assert.equal(feed.safeUrl("JavaScript:alert(1)"), "");
    assert.equal(feed.safeUrl("data:text/html,<script>alert(1)</script>"), "");
    assert.equal(feed.safeUrl("vbscript:msgbox(1)"), "");
  });

  test("rejects a protocol-relative URL, which would silently inherit the scheme", () => {
    assert.equal(feed.safeUrl("//evil.example/x"), "");
  });

  test("returns empty for missing values", () => {
    assert.equal(feed.safeUrl(null), "");
    assert.equal(feed.safeUrl(undefined), "");
    assert.equal(feed.safeUrl("   "), "");
  });
});

describe("safeImage", () => {
  test("allows relative asset paths and absolute https URLs", () => {
    assert.equal(feed.safeImage("./assets/WG.png"), "./assets/WG.png");
    assert.equal(feed.safeImage("/assets/WG.png"), "/assets/WG.png");
    assert.equal(
      feed.safeImage("https://media.lumina-frameworks.com/projects/a.png"),
      "https://media.lumina-frameworks.com/projects/a.png"
    );
  });

  test("rejects a data: URI", () => {
    assert.equal(feed.safeImage("data:image/svg+xml,<svg onload=alert(1)>"), "");
  });

  test("rejects an attribute-breakout attempt", () => {
    assert.equal(feed.safeImage('x" onerror="alert(1)'), "");
    assert.equal(feed.safeImage("x' onerror='alert(1)"), "");
  });

  test("rejects javascript: in an image src", () => {
    assert.equal(feed.safeImage("javascript:alert(1)"), "");
  });
});

describe("loadProjects", () => {
  const realFetch = globalThis.fetch;

  function stub(payload, { ok = true, status = 200 } = {}) {
    globalThis.fetch = async () => ({
      ok,
      status,
      json: async () => payload
    });
  }

  test("normalises a project into the shape the pages render", async () => {
    stub({
      projects: [
        {
          id: "akari",
          title: "A.K.A.R.I.",
          symbol: "AK",
          category: "Product",
          year: "2026",
          image: "./assets/project-akari.jpg",
          blurb: "Coach.",
          tagline: "PC BUILD COACH",
          stack: ["OpenRouter", "Streaming chat"],
          tags: ["llm", "education"],
          url: "https://akari.lumina-frameworks.com/",
          featured: true
        }
      ]
    });
    const [project] = await feed.loadProjects();
    assert.equal(project.slug, "akari");
    assert.equal(project.year, 2026, "year is coerced to a number for sorting");
    assert.deepEqual(project.stack, ["OpenRouter", "Streaming chat"]);
    assert.equal(project.url, "https://akari.lumina-frameworks.com/");
    globalThis.fetch = realFetch;
  });

  test("strips hostile fields from a compromised or malicious API payload", async () => {
    stub({
      projects: [
        {
          title: '<img src=x onerror="alert(1)">',
          symbol: "X",
          category: "Product",
          year: 2026,
          image: "javascript:alert(1)",
          blurb: "<script>alert(2)</script>",
          stack: ["ok", "", null, 42, "<b>x</b>"],
          tags: "not-an-array",
          url: "javascript:alert(3)",
          featured: 1
        }
      ]
    });
    const [project] = await feed.loadProjects();
    assert.equal(project.url, "", "javascript: URL dropped");
    assert.equal(project.image, "", "javascript: image dropped");
    assert.deepEqual(
      project.stack,
      ["ok", "<b>x</b>"],
      "non-strings and empties dropped; markup survives as text and is escaped at render time"
    );
    assert.deepEqual(project.tags, [], "a non-array tags value becomes empty");
    assert.equal(
      feed.escapeHtml(project.stack[1]),
      "&lt;b&gt;x&lt;/b&gt;",
      "and that leftover markup is inert once rendered"
    );
    globalThis.fetch = realFetch;
  });

  test("throws on a non-ok response so the caller can fall back", async () => {
    stub({}, { ok: false, status: 500 });
    await assert.rejects(() => feed.loadProjects(), /returned 500/);
    globalThis.fetch = realFetch;
  });

  test("throws on an empty list so the caller can fall back", async () => {
    stub({ projects: [] });
    await assert.rejects(() => feed.loadProjects(), /empty list/);
    globalThis.fetch = realFetch;
  });

  test("requests the featured filter when asked", async () => {
    let requested = null;
    globalThis.fetch = async (url) => {
      requested = String(url);
      return { ok: true, status: 200, json: async () => ({ projects: [{ title: "A", symbol: "A", category: "C", year: 2026 }] }) };
    };
    await feed.loadProjects({ featured: true });
    assert.equal(requested, "/api/projects?featured=1");
    await feed.loadProjects();
    assert.equal(requested, "/api/projects");
    globalThis.fetch = realFetch;
  });
});
