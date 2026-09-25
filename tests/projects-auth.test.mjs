/**
 * Tests for the project validation and auth primitives.
 * Run: node --test tests/
 *
 * These cover the bits that decide whether admin input can reach the public
 * site and whether a session is trusted, so they're worth asserting on.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  slugify,
  validateProjectInput,
  rowToProject
} from "../functions/_shared/projects.js";
import {
  adminEmails,
  isAllowedAdmin,
  signSession,
  verifySession
} from "../functions/_shared/auth.js";
import { buildSystemPrompt, formatProjects } from "../functions/_shared/lumi-prompt.js";

describe("validateProjectInput", () => {
  const valid = {
    title: "Test Project",
    symbol: "tp",
    category: "Product",
    year: 2026,
    blurb: "A thing we built.",
    stack: ["A", "B"],
    tags: ["One", "Two"],
    url: "https://example.com/",
    featured: true,
    published: true,
    sort_order: 3
  };

  test("accepts a well-formed payload and normalises it", () => {
    const result = validateProjectInput(valid);
    assert.equal(result.ok, true);
    assert.equal(result.value.symbol, "TP", "symbol is uppercased");
    assert.equal(result.value.stack, '["A","B"]');
    assert.equal(result.value.tags, '["one","two"]', "tags are lowercased");
    assert.equal(result.value.featured, 1);
    assert.equal(result.value.sort_order, 3);
  });

  test("rejects missing fields", () => {
    const result = validateProjectInput({ title: "  " });
    assert.equal(result.ok, false);
    assert.ok(result.errors.length >= 4);
  });

  test("rejects an out-of-range year", () => {
    assert.equal(validateProjectInput({ ...valid, year: "nope" }).ok, false);
    assert.equal(validateProjectInput({ ...valid, year: 1200 }).ok, false);
  });

  test("rejects a javascript: project URL", () => {
    const result = validateProjectInput({
      ...valid,
      url: "javascript:alert(document.cookie)"
    });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(" "), /http:\/\/ or https:\/\//);
  });

  test("rejects a data: image and a script-bearing image path", () => {
    assert.equal(
      validateProjectInput({ ...valid, image_url: "data:image/svg+xml,<svg onload=alert(1)>" }).ok,
      false
    );
    assert.equal(
      validateProjectInput({ ...valid, image_url: 'x" onerror="alert(1)' }).ok,
      false
    );
  });

  test("accepts a relative asset path and an https media URL", () => {
    assert.equal(validateProjectInput({ ...valid, image_url: "./assets/a.png" }).ok, true);
    assert.equal(
      validateProjectInput({ ...valid, image_url: "https://media.lumina-frameworks.com/projects/a.png" }).ok,
      true
    );
  });

  test("caps stack and tag counts", () => {
    const result = validateProjectInput({
      ...valid,
      stack: Array.from({ length: 20 }, (_, i) => `s${i}`),
      tags: Array.from({ length: 40 }, (_, i) => `t${i}`)
    });
    assert.equal(JSON.parse(result.value.stack).length, 6);
    assert.equal(JSON.parse(result.value.tags).length, 12);
  });

  test("defaults published to 1 and honours an explicit 0", () => {
    assert.equal(validateProjectInput({ ...valid, published: undefined }).value.published, 1);
    assert.equal(validateProjectInput({ ...valid, published: false }).value.published, 0);
  });
});

describe("slugify", () => {
  test("produces url-safe slugs", () => {
    assert.equal(slugify("A.K.A.R.I."), "a-k-a-r-i");
    assert.equal(slugify("  Write Genius  "), "write-genius");
    assert.equal(slugify("Café Déjà Vu"), "cafe-deja-vu");
    assert.equal(slugify("!!!"), "");
  });
});

describe("rowToProject", () => {
  test("maps a D1 row into the front-end shape", () => {
    const project = rowToProject({
      slug: "akari",
      title: "A.K.A.R.I.",
      symbol: "AK",
      category: "Product",
      year: 2026,
      image_url: "./assets/project-akari.jpg",
      blurb: "Coach.",
      tagline: "PC BUILD COACH",
      stack: '["OpenRouter"]',
      tags: '["llm"]',
      url: "https://example.com/",
      featured: 1,
      published: 1,
      sort_order: 2,
      created_at: "2026-01-01",
      updated_at: "2026-01-01"
    });
    assert.equal(project.id, "akari");
    assert.equal(project.image, "./assets/project-akari.jpg");
    assert.deepEqual(project.stack, ["OpenRouter"]);
    assert.equal(project.featured, true);
    assert.equal(project.tagline, "PC BUILD COACH");
  });

  test("survives malformed JSON columns instead of throwing", () => {
    const project = rowToProject({
      slug: "x",
      title: "X",
      stack: "not json",
      tags: null,
      featured: 0,
      published: 1,
      sort_order: 0,
      year: 2025
    });
    assert.deepEqual(project.stack, []);
    assert.deepEqual(project.tags, []);
    assert.equal(project.url, null);
  });
});

describe("admin allowlist", () => {
  test("parses a comma-separated list case-insensitively", () => {
    const env = { ADMIN_EMAILS: " Amir@Example.com , aliff@example.com ,, " };
    assert.deepEqual(adminEmails(env), ["amir@example.com", "aliff@example.com"]);
    assert.equal(isAllowedAdmin(env, "AMIR@example.com"), true);
    assert.equal(isAllowedAdmin(env, "stranger@example.com"), false);
  });

  test("denies everyone when the allowlist is unset or empty", () => {
    assert.equal(isAllowedAdmin({}, "amir@example.com"), false);
    assert.equal(isAllowedAdmin({ ADMIN_EMAILS: "   " }, "amir@example.com"), false);
  });
});

describe("session tokens", () => {
  const secret = "test-secret-value-not-used-in-production";
  const claims = { sub: "123", email: "amir@example.com", exp: Math.floor(Date.now() / 1000) + 600 };

  test("round-trips a signed session", async () => {
    const token = await signSession(claims, secret);
    const verified = await verifySession(token, secret);
    assert.equal(verified.email, "amir@example.com");
  });

  test("rejects a token signed with a different secret", async () => {
    const token = await signSession(claims, secret);
    assert.equal(await verifySession(token, "a-different-secret"), null);
  });

  test("rejects a tampered payload", async () => {
    const token = await signSession(claims, secret);
    const [header, , signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...claims, email: "attacker@example.com" })
    ).toString("base64url");
    assert.equal(await verifySession(`${header}.${forged}.${signature}`, secret), null);
  });

  test("rejects an expired session", async () => {
    const expired = { ...claims, exp: Math.floor(Date.now() / 1000) - 10 };
    const token = await signSession(expired, secret);
    assert.equal(await verifySession(token, secret), null);
  });

  test("rejects a garbage token", async () => {
    assert.equal(await verifySession("not-a-token", secret), null);
    assert.equal(await verifySession("", secret), null);
    assert.equal(await verifySession(null, secret), null);
  });
});

describe("Lumi system prompt", () => {
  test("renders a project line with a clickable host when a URL exists", () => {
    const text = formatProjects([
      { title: "Write Genius", blurb: "Academic platform.", url: "https://writegeniusofficial.pages.dev/" }
    ]);
    assert.equal(
      text,
      "- Write Genius: Academic platform. Live website: [writegeniusofficial.pages.dev](https://writegeniusofficial.pages.dev/)"
    );
  });

  test("includes the tagline as a parenthetical label", () => {
    const text = formatProjects([
      { title: "A.K.A.R.I.", tagline: "PC BUILD COACH", blurb: "PC coach.", url: null }
    ]);
    assert.equal(text, "- A.K.A.R.I. (PC BUILD COACH): PC coach.");
  });

  test("omits the parenthetical when there is no tagline", () => {
    const text = formatProjects([{ title: "X", blurb: "No label.", url: null }]);
    assert.equal(text, "- X: No label.");
  });

  test("does not emit a double period when the blurb already ends in one", () => {
    const text = formatProjects([{ title: "X", blurb: "Ends with a dot...", url: null }]);
    assert.equal(text, "- X: Ends with a dot.");
  });

  test("omits the link when a project has no URL", () => {
    const text = formatProjects([{ title: "Hermes Desk", blurb: "Agent desk.", url: null }]);
    assert.equal(text, "- Hermes Desk: Agent desk.");
  });

  test("falls back to the built-in list when D1 returns nothing", () => {
    const text = buildSystemPrompt([]);
    assert.match(text, /A\.K\.A\.R\.I\./);
    assert.match(text, /PROJECTS/);
    assert.match(text, /OPENING ENERGY/);
  });

  test("injects live projects and does not leak the fallback list", () => {
    const text = buildSystemPrompt([
      { title: "Brand New Thing", blurb: "Just shipped.", url: "https://example.com/x" }
    ]);
    assert.match(text, /Brand New Thing/);
    assert.doesNotMatch(text, /Arefa Hermes/);
  });
});
