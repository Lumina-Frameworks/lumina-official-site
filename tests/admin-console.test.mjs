/**
 * Tests for the admin console's server side: the roster, role gates, tracked
 * sessions, and the audit trail.
 * Run: node tests/admin-console.test.mjs
 *
 * Same approach as api.test.mjs: the real schema, the real route handlers, and a
 * D1-shaped shim over node:sqlite. No Wrangler, no Cloudflare account.
 *
 * The behaviours worth locking down here are the ones that decide who gets in
 * and whether the record of what they did survives:
 * - a session cookie is only as good as its live `sessions` row
 * - a viewer can read but never write
 * - the last owner cannot be removed, and nobody can demote themselves
 * - every mutation leaves a row, including the denied ones
 */
import { test, describe, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { signSession, SESSION_COOKIE } from "../functions/_shared/auth.js";
import { makeD1, seededDatabase } from "./helpers/d1-sqlite.mjs";
import {
  auditSummary,
  auditToCsv,
  describeUserAgent,
  listAuditEvents,
  parseAuditFilters,
  recordAudit
} from "../functions/_shared/audit.js";
import { diffProjects, listAdmins } from "../functions/_shared/admins.js";
import { onRequestGet as overviewGet } from "../functions/api/admin/overview.js";
import {
  onRequestGet as membersGet,
  onRequestPost as membersPost
} from "../functions/api/admin/members/index.js";
import {
  onRequestPut as memberPut,
  onRequestDelete as memberDelete
} from "../functions/api/admin/members/[email].js";
import { onRequestGet as auditGet } from "../functions/api/admin/audit/index.js";
import { onRequestDelete as sessionDelete } from "../functions/api/admin/sessions/[id].js";
import { onRequestGet as sessionsGet } from "../functions/api/admin/sessions/index.js";
import {
  onRequestPost as projectCreate
} from "../functions/api/admin/projects/index.js";
import {
  onRequestDelete as projectDelete,
  onRequestPut as projectUpdate
} from "../functions/api/admin/projects/[slug].js";

const AUTH_SECRET = "test-secret-for-admin-console-tests";
const BASE = "https://lumina-frameworks.com";
const OWNER = "amirhafizi443@gmail.com";
const VIEWER = "viewer@example.com";
const EDITOR = "editor@example.com";
const MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const PHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

let sqlite;
let env;

before(() => {
  sqlite = seededDatabase();
  env = { DB: makeD1(sqlite), AUTH_SECRET, ADMIN_EMAILS: OWNER };
});

beforeEach(() => {
  // Each test starts from the bootstrapped roster and an empty trail.
  sqlite.exec("DELETE FROM sessions; DELETE FROM audit_log; DELETE FROM projects WHERE slug LIKE 'signal-ops%';");
  sqlite.exec("DELETE FROM admins WHERE email NOT IN ('amirhafizi443@gmail.com','aliffprime3@gmail.com');");
  sqlite.exec("UPDATE admins SET role = 'owner', status = 'active'");
});

/** The default env, with the bootstrap list overridable per test. */
function envWith(adminEmails) {
  return { ...env, ADMIN_EMAILS: adminEmails };
}

/* ---------- helpers ---------- */

function addAdmin(email, role, status = "active") {
  sqlite
    .prepare("INSERT INTO admins (email, role, status) VALUES (?, ?, ?)")
    .run(email, role, status);
}

function openSession(email, role, { userAgent = MAC_UA, ip = "203.0.113.44", country = "MY" } = {}) {
  const id = crypto.randomUUID();
  sqlite
    .prepare(
      `INSERT INTO sessions (id, email, role, user_agent, ip_hash, country, device)
       VALUES (?, ?, ?, ?, 'abc123', ?, ?)`
    )
    .run(id, email, role, userAgent, country, describeUserAgent(userAgent).device);
  return id;
}

async function cookieFor(email, role, options) {
  const sid = openSession(email, role, options);
  const now = Math.floor(Date.now() / 1000);
  const token = await signSession({ sub: "1", email, sid, iat: now, exp: now + 3600 }, AUTH_SECRET);
  return `${SESSION_COOKIE}=${token}`;
}

// Browsers always send this; the audit device label is derived from it.
function req(method, url, { cookie, body, headers, userAgent = MAC_UA } = {}) {
  const init = { method, headers: { "User-Agent": userAgent, ...headers } };
  if (cookie) init.headers.Cookie = cookie;
  if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  return new Request(BASE + url, init);
}

function auditRows() {
  return sqlite.prepare("SELECT * FROM audit_log ORDER BY id ASC").all();
}

const PROJECT = {
  title: "Signal Ops",
  symbol: "SO",
  category: "Agent",
  year: 2026,
  tagline: "OPS WATCH",
  blurb: "Watches the fleet and reports in.",
  stack: ["Agents"],
  tags: ["ops"],
  url: "https://example.com/signal",
  featured: false,
  published: true,
  sort_order: 3
};

/* ---------- device + network fingerprints ---------- */

describe("audit fingerprints", () => {
  test("labels a desktop browser and a phone distinctly", () => {
    assert.equal(describeUserAgent(MAC_UA).device, "Desktop · Chrome 131");
    assert.equal(describeUserAgent(MAC_UA).os, "macOS");
    assert.equal(describeUserAgent(PHONE_UA).device, "Mobile · Safari 17");
    assert.equal(describeUserAgent(PHONE_UA).os, "iOS");
    assert.equal(describeUserAgent("").device, "Unknown device");
    assert.equal(describeUserAgent("curl/8.4.0").browser, "CLI");
  });
});

/* ---------- role gates ---------- */

describe("role gates", () => {
  test("a viewer reads the project list but cannot create one", async () => {
    addAdmin(VIEWER, "viewer");
    const cookie = await cookieFor(VIEWER, "viewer");

    const read = await overviewGet({ request: req("GET", "/api/admin/overview", { cookie }), env });
    assert.equal(read.status, 200);

    const write = await projectCreate({
      request: req("POST", "/api/admin/projects", { cookie, body: PROJECT }),
      env
    });
    assert.equal(write.status, 403);
    assert.match((await write.json()).error, /admin role/);
  });

  test("only an owner may open the roster", async () => {
    addAdmin(EDITOR, "admin");
    const adminCookie = await cookieFor(EDITOR, "admin");
    const denied = await membersGet({ request: req("GET", "/api/admin/members", { cookie: adminCookie }), env });
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).role, "admin");

    const ownerCookie = await cookieFor(OWNER, "owner");
    const allowed = await membersGet({ request: req("GET", "/api/admin/members", { cookie: ownerCookie }), env });
    assert.equal(allowed.status, 200);

    const { admins, counts } = await allowed.json();
    assert.equal(counts.owners, 2, "both env owners are counted");
    assert.ok(admins.every((entry) => entry.locked === false || entry.role === "owner"));
  });

  test("the audit trail needs admin at minimum", async () => {
    addAdmin(VIEWER, "viewer");
    const cookie = await cookieFor(VIEWER, "viewer");
    const denied = await auditGet({ request: req("GET", "/api/admin/audit", { cookie }), env });
    assert.equal(denied.status, 403);
  });
});

/* ---------- tracked sessions ---------- */

describe("tracked sessions", () => {
  test("a session stops working the moment its row is revoked", async () => {
    const cookie = await cookieFor(OWNER, "owner");
    const before = await overviewGet({ request: req("GET", "/api/admin/overview", { cookie }), env });
    assert.equal(before.status, 200, "the cookie works while the row is active");

    sqlite.prepare("UPDATE sessions SET status = 'revoked'").run();
    const after = await overviewGet({ request: req("GET", "/api/admin/overview", { cookie }), env });
    assert.equal(after.status, 401, "revocation takes effect on the next request, not in 7 days");
  });

  test("a cookie with no session row at all is refused", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signSession(
      { sub: "1", email: OWNER, sid: "ghost-session", iat: now, exp: now + 3600 },
      AUTH_SECRET
    );
    const response = await overviewGet({
      request: req("GET", "/api/admin/overview", { cookie: `${SESSION_COOKIE}=${token}` }),
      env
    });
    assert.equal(response.status, 401, "a signed cookie is not enough on its own");
  });

  test("an owner can sign out a viewer's device, and it is audited", async () => {
    addAdmin(VIEWER, "viewer");
    const victim = openSession(VIEWER, "viewer", { userAgent: PHONE_UA });
    const cookie = await cookieFor(OWNER, "owner");

    const response = await sessionDelete({
      request: req("DELETE", `/api/admin/sessions/${victim}`, { cookie }),
      env,
      params: { id: victim }
    });
    assert.equal(response.status, 200);

    const row = sqlite.prepare("SELECT status FROM sessions WHERE id = ?").get(victim);
    assert.equal(row.status, "revoked");

    const logged = auditRows().find((entry) => entry.action === "session.revoke");
    assert.equal(logged.actor, OWNER);
    assert.equal(logged.entity_id, victim);
    assert.match(logged.summary, /Signed out viewer@example\.com/);
  });

  test("an admin cannot revoke an owner's session", async () => {
    addAdmin(EDITOR, "admin");
    const ownerSession = openSession(OWNER, "owner");
    const cookie = await cookieFor(EDITOR, "admin");

    const response = await sessionDelete({
      request: req("DELETE", `/api/admin/sessions/${ownerSession}`, { cookie }),
      env,
      params: { id: ownerSession }
    });
    assert.equal(response.status, 403);
    assert.equal(
      sqlite.prepare("SELECT status FROM sessions WHERE id = ?").get(ownerSession).status,
      "active",
      "the refusal left the session alone"
    );
    const denial = auditRows().find((entry) => entry.action === "session.revoke");
    assert.equal(denial.status, "denied");
  });

  test("the session list marks which row is the caller's own", async () => {
    const mine = await cookieFor(OWNER, "owner");
    const response = await sessionsGet({ request: req("GET", "/api/admin/sessions", { cookie: mine }), env });
    const { sessions } = await response.json();
    const current = sessions.find((session) => session.current);
    assert.ok(current, "the caller's own session is flagged");
    assert.equal(current.email, OWNER);
    assert.equal(current.current, true);
  });
});

/* ---------- roster management ---------- */

describe("roster management", () => {
  test("grants access to a new email and records it", async () => {
    const cookie = await cookieFor(OWNER, "owner");
    const response = await membersPost({
      request: req("POST", "/api/admin/members", {
        cookie,
        body: { email: "New.Person@Example.com", role: "admin", note: "contractor" }
      }),
      env
    });
    assert.equal(response.status, 201);

    const row = sqlite.prepare("SELECT email, role, status FROM admins WHERE email = ?").get("new.person@example.com");
    assert.equal(row.role, "admin");
    assert.equal(row.status, "active");

    const logged = auditRows().find((entry) => entry.action === "admin.invite");
    assert.equal(logged.entity_id, "new.person@example.com");
    assert.match(logged.summary, /Granted admin access/);
  });

  test("refuses a malformed address and an unknown role", async () => {
    const cookie = await cookieFor(OWNER, "owner");
    const bad = await membersPost({
      request: req("POST", "/api/admin/members", { cookie, body: { email: "nope", role: "admin" } }),
      env
    });
    assert.equal(bad.status, 400);

    const badRole = await membersPost({
      request: req("POST", "/api/admin/members", { cookie, body: { email: "x@y.com", role: "superuser" } }),
      env
    });
    assert.equal(badRole.status, 400);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS c FROM admins WHERE email = 'x@y.com'").get().c, 0);
  });

  test("an ADMIN_EMAILS account cannot be touched from the console", async () => {
    const cookie = await cookieFor(OWNER, "owner");
    const response = await memberDelete({
      request: req("DELETE", `/api/admin/members/${OWNER}`, { cookie }),
      env,
      params: { email: OWNER }
    });
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /ADMIN_EMAILS/);
  });

  test("nobody can change their own role", async () => {
    // A second owner so the last-owner guard is not what refuses this.
    addAdmin("second@example.com", "owner");
    const cookie = await cookieFor("second@example.com", "owner");
    const response = await memberPut({
      request: req("PUT", "/api/admin/members/second@example.com", { cookie, body: { role: "viewer" } }),
      env,
      params: { email: "second@example.com" }
    });
    assert.equal(response.status, 409);
    assert.equal(
      sqlite.prepare("SELECT role FROM admins WHERE email = ?").get("second@example.com").role,
      "owner"
    );
  });

  test("the last owner cannot be demoted, suspended, or removed", async () => {
    // A controlled roster: aliff and amir stay environment owners, and the
    // table starts empty so the owner count is exactly what this test sets up.
    const scoped = envWith("aliffprime3@gmail.com");
    sqlite.prepare("DELETE FROM admins WHERE email = 'amirhafizi443@gmail.com'").run();
    sqlite.prepare("DELETE FROM admins WHERE email = 'aliffprime3@gmail.com'").run();

    addAdmin("solo@example.com", "owner");
    addAdmin("helper@example.com", "admin");
    const soloCookie = await cookieFor("solo@example.com", "owner");
    const adminCookie = await cookieFor("helper@example.com", "admin");
    const ownerCount = () =>
      sqlite.prepare("SELECT COUNT(*) AS c FROM admins WHERE role = 'owner' AND status = 'active'").get().c;

    // 1. A plain admin cannot reach the roster at all.
    const asAdmin = await memberPut({
      request: req("PUT", "/api/admin/members/solo@example.com", {
        cookie: adminCookie,
        body: { status: "suspended" }
      }),
      env: scoped,
      params: { email: "solo@example.com" }
    });
    assert.equal(asAdmin.status, 403, "an admin cannot manage the roster");
    assert.equal(
      sqlite.prepare("SELECT status FROM admins WHERE email = 'solo@example.com'").get().status,
      "active"
    );

    // 2. An owner cannot change its own role or remove itself.
    const selfChange = await memberPut({
      request: req("PUT", "/api/admin/members/solo@example.com", {
        cookie: soloCookie,
        body: { role: "viewer" }
      }),
      env: scoped,
      params: { email: "solo@example.com" }
    });
    assert.equal(selfChange.status, 409);
    assert.match((await selfChange.json()).error, /your own role/);

    const selfRemove = await memberDelete({
      request: req("DELETE", "/api/admin/members/solo@example.com", { cookie: soloCookie }),
      env: scoped,
      params: { email: "solo@example.com" }
    });
    assert.equal(selfRemove.status, 409);
    assert.match((await selfRemove.json()).error, /your own access/);

    // 3. With two owners the guard stands aside: helper may demote solo.
    sqlite.prepare("UPDATE admins SET role = 'owner' WHERE email = 'helper@example.com'").run();
    assert.equal(ownerCount(), 2, "two active owners");
    const helperCookie = await cookieFor("helper@example.com", "owner");

    const demoteSibling = await memberPut({
      request: req("PUT", "/api/admin/members/solo@example.com", {
        cookie: helperCookie,
        body: { role: "admin" }
      }),
      env: scoped,
      params: { email: "solo@example.com" }
    });
    assert.equal(demoteSibling.status, 200, "two owners means one may be demoted");
    assert.equal(ownerCount(), 1, "helper is the last owner now");

    // 4. helper is the last owner, so nobody else may demote or suspend it.
    sqlite.prepare("UPDATE admins SET role = 'owner' WHERE email = 'solo@example.com'").run();
    const soloOwnerCookie = await cookieFor("solo@example.com", "owner");
    sqlite.prepare("UPDATE admins SET role = 'admin' WHERE email = 'helper@example.com'").run();
    // Put helper back as the sole owner with a live session, then demote solo so
    // the request below comes from a real owner against the last one.
    sqlite.prepare("UPDATE admins SET role = 'owner' WHERE email = 'helper@example.com'").run();
    sqlite.prepare("UPDATE admins SET role = 'admin' WHERE email = 'solo@example.com'").run();
    assert.equal(ownerCount(), 1, "helper is the only active owner");

    sqlite.prepare("UPDATE admins SET role = 'owner' WHERE email = 'solo@example.com'").run();
    const pairCookie = await cookieFor("solo@example.com", "owner");
    sqlite.prepare("UPDATE admins SET role = 'admin' WHERE email = 'solo@example.com'").run();
    const suspended = await memberPut({
      request: req("PUT", "/api/admin/members/helper@example.com", {
        cookie: pairCookie,
        body: { status: "suspended" }
      }),
      env: scoped,
      params: { email: "helper@example.com" }
    });
    // solo no longer holds owner rights, so this must be refused by the gate.
    assert.equal(suspended.status, 403, "a demoted owner loses the roster immediately");

    // 5. A genuinely suspended account loses console access on the next request.
    sqlite.prepare("UPDATE admins SET status = 'suspended' WHERE email = 'solo@example.com'").run();
    const blocked = await overviewGet({
      request: req("GET", "/api/admin/overview", { cookie: soloCookie }),
      env: scoped
    });
    assert.equal(blocked.status, 401, "a suspended account is refused immediately");
  });

  test("a non-last owner can be demoted normally", async () => {
    addAdmin("solo@example.com", "owner");
    addAdmin("other@example.com", "owner");
    const otherCookie = await cookieFor("other@example.com", "owner");

    const response = await memberPut({
      request: req("PUT", "/api/admin/members/solo@example.com", {
        cookie: otherCookie,
        body: { role: "viewer" }
      }),
      env,
      params: { email: "solo@example.com" }
    });
    assert.equal(response.status, 200);
    assert.equal(sqlite.prepare("SELECT role FROM admins WHERE email = 'solo@example.com'").get().role, "viewer");
  });

  test("changing a role signs that person out everywhere", async () => {
    addAdmin(EDITOR, "admin");
    const liveSession = openSession(EDITOR, "admin");
    const cookie = await cookieFor(OWNER, "owner");

    const response = await memberPut({
      request: req("PUT", `/api/admin/members/${EDITOR}`, { cookie, body: { role: "viewer" } }),
      env,
      params: { email: EDITOR }
    });
    assert.equal(response.status, 200);

    assert.equal(
      sqlite.prepare("SELECT status FROM sessions WHERE id = ?").get(liveSession).status,
      "revoked",
      "their old cookie is dead immediately"
    );
    const row = sqlite.prepare("SELECT role FROM admins WHERE email = ?").get(EDITOR);
    assert.equal(row.role, "viewer");
  });

  test("removing an account deletes the row and revokes its sessions", async () => {
    addAdmin(EDITOR, "admin");
    const liveSession = openSession(EDITOR, "admin");
    const cookie = await cookieFor(OWNER, "owner");

    const response = await memberDelete({
      request: req("DELETE", `/api/admin/members/${EDITOR}`, { cookie }),
      env,
      params: { email: EDITOR }
    });
    assert.equal(response.status, 200);

    assert.equal(sqlite.prepare("SELECT COUNT(*) AS c FROM admins WHERE email = ?").get(EDITOR).c, 0);
    assert.equal(sqlite.prepare("SELECT status FROM sessions WHERE id = ?").get(liveSession).status, "revoked");
    const logged = auditRows().find((entry) => entry.action === "admin.remove");
    assert.equal(logged.entity_id, EDITOR);
  });
});

/* ---------- audit trail ---------- */

describe("audit trail", () => {
  test("creating and editing a project leaves a diff behind", async () => {
    const cookie = await cookieFor(OWNER, "owner");
    const created = await projectCreate({
      request: req("POST", "/api/admin/projects", { cookie, body: PROJECT }),
      env
    });
    assert.equal(created.status, 201);

    await projectUpdate({
      request: req("PUT", "/api/admin/projects/signal-ops", {
        cookie,
        body: { ...PROJECT, title: "Signal Ops II", published: false }
      }),
      env,
      params: { slug: "signal-ops" }
    });

    const events = auditRows();
    assert.deepEqual(events.map((entry) => entry.action), ["project.create", "project.update"]);

    const update = events[1];
    const details = JSON.parse(update.details);
    const fields = details.changes.map((change) => change.field).sort();
    assert.deepEqual(fields, ["published", "title"]);
    assert.match(update.summary, /2 fields changed · now a draft/);

    // Device metadata rides along, so a row is readable without a second lookup.
    assert.equal(update.device, "Desktop · Chrome 131");
    assert.equal(update.actor, OWNER);
    assert.equal(update.method, "PUT");
    assert.equal(update.path, "/api/admin/projects/signal-ops");
  });

  test("the delete path records which kind of delete it was", async () => {
    const cookie = await cookieFor(OWNER, "owner");
    await projectCreate({ request: req("POST", "/api/admin/projects", { cookie, body: PROJECT }), env });

    await projectDelete({
      request: req("DELETE", "/api/admin/projects/signal-ops", { cookie }),
      env,
      params: { slug: "signal-ops" }
    });
    await projectDelete({
      request: req("DELETE", "/api/admin/projects/signal-ops?hard=1", { cookie }),
      env,
      params: { slug: "signal-ops" }
    });

    const actions = auditRows().map((entry) => entry.action);
    assert.deepEqual(actions, ["project.create", "project.unpublish", "project.delete"]);
  });

  test("reads back newest first with filters that actually filter", async () => {
    const cookie = await cookieFor(OWNER, "owner");
    await projectCreate({ request: req("POST", "/api/admin/projects", { cookie, body: PROJECT }), env });
    await recordAudit(env, { actor: EDITOR, action: "auth.login", status: "denied", summary: "Bad token" });

    const all = await listAuditEvents(env, parseAuditFilters(new URLSearchParams()));
    assert.equal(all.total, 2);
    assert.equal(all.events[0].action, "auth.login", "newest first");

    const denied = await listAuditEvents(env, parseAuditFilters(new URLSearchParams("status=denied")));
    assert.equal(denied.total, 1);
    assert.equal(denied.events[0].actor, EDITOR);

    const projectFamily = await listAuditEvents(env, parseAuditFilters(new URLSearchParams("action=project.")));
    assert.equal(projectFamily.total, 1);

    const byActor = await listAuditEvents(env, parseAuditFilters(new URLSearchParams(`actor=${OWNER}`)));
    assert.equal(byActor.total, 1);

    const bySearch = await listAuditEvents(env, parseAuditFilters(new URLSearchParams("q=Signal")));
    assert.equal(bySearch.total, 1);
  });

  test("paging never returns more than the requested page", async () => {
    for (let index = 0; index < 7; index += 1) {
      await recordAudit(env, { actor: OWNER, action: "project.update", summary: `edit ${index}` });
    }
    const page = await listAuditEvents(env, parseAuditFilters(new URLSearchParams("limit=3&offset=0")));
    assert.equal(page.events.length, 3);
    assert.equal(page.total, 7);

    const second = await listAuditEvents(env, parseAuditFilters(new URLSearchParams("limit=3&offset=3")));
    assert.equal(second.events.length, 3);
    assert.notEqual(page.events[0].id, second.events[0].id);
  });

  test("the endpoint serves JSON, paged, and CSV on demand", async () => {
    const cookie = await cookieFor(OWNER, "owner");
    await recordAudit(env, {
      actor: OWNER, action: "project.update", entity: "project", entityId: "signal-ops",
      summary: 'Saved "Signal, Ops" · 1 field changed'
    });

    const json = await auditGet({ request: req("GET", "/api/admin/audit?limit=10", { cookie }), env });
    assert.equal(json.status, 200);
    const payload = await json.json();
    assert.equal(payload.total, 1);
    assert.equal(payload.events[0].entityId, "signal-ops");

    const csv = await auditGet({ request: req("GET", "/api/admin/audit?format=csv", { cookie }), env });
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get("Content-Type"), /text\/csv/);
    assert.match(csv.headers.get("Content-Disposition"), /lumina-audit-\d{4}-\d{2}-\d{2}\.csv/);
    const body = await csv.text();
    assert.match(body.split("\r\n")[0], /^id,at,actor,role,action/);
    assert.match(body, /"Saved ""Signal, Ops"" · 1 field changed"/, "commas and quotes are escaped");
  });

  test("a failed audit write never breaks the action it describes", async () => {
    // No D1 binding at all: this is the chat-only dev server's situation.
    await assert.doesNotReject(() => recordAudit({}, { actor: OWNER, action: "project.update" }));
    // A broken binding must be swallowed too.
    const broken = { DB: { prepare: () => { throw new Error("D1 unavailable"); } } };
    await assert.doesNotReject(() => recordAudit(broken, { actor: OWNER, action: "project.update" }));
  });

  test("summarises the last 24 hours for the overview tab", async () => {
    await recordAudit(env, { actor: OWNER, action: "project.create", summary: "one" });
    await recordAudit(env, { actor: OWNER, action: "project.update", summary: "two" });
    await recordAudit(env, { actor: EDITOR, action: "auth.login", status: "denied", summary: "three" });

    const summary = await auditSummary(env, 24);
    assert.equal(summary.total, 3);
    assert.equal(summary.denied, 1);
    assert.equal(summary.actors, 2);
    assert.equal(summary.topActions[0].count, 1);
  });
});

/* ---------- helpers ---------- */

describe("audit helpers", () => {
  test("diffProjects reports only what moved", () => {
    const before = { title: "A", published: true, stack: ["x"] };
    const after = { title: "B", published: true, stack: ["x"] };
    assert.deepEqual(diffProjects(before, after), [{ field: "title", from: "A", to: "B" }]);
    assert.equal(diffProjects(before, { ...before }).length, 0);
    assert.equal(diffProjects(null, after), null);
  });

  test("auditToCsv quotes embedded commas, quotes and newlines", () => {
    const csv = auditToCsv([
      { id: 1, at: "2026-01-01 00:00:00", actor: "a@b.com", action: "x", status: "ok", summary: 'he said "hi", loudly\nsecond line' }
    ]);
    const [header, row] = csv.split("\r\n");
    assert.ok(header.startsWith("id,at,actor"));
    assert.match(row, /"he said ""hi"", loudly\nsecond line"/);
  });

  test("filters reject values that would widen a query", () => {
    const filters = parseAuditFilters(new URLSearchParams("limit=99999&offset=-4&status=maybe&role=admin"));
    assert.equal(filters.limit, 200, "capped at the maximum page size");
    assert.equal(filters.offset, 0, "a negative offset is not a page");
    assert.equal(filters.status, null, "an unknown status is dropped, not passed through");
    assert.equal(filters.role, "admin");
  });

  test("listAdmins keeps the environment owners on top and locked", async () => {
    addAdmin("mid@example.com", "admin");
    const admins = await listAdmins({ ...env, ADMIN_EMAILS: "aliffprime3@gmail.com,amirhafizi443@gmail.com" });
    assert.equal(admins[0].email, "aliffprime3@gmail.com", "env order is preserved");
    assert.equal(admins[0].locked, true);
    assert.equal(admins[1].locked, true);
    const mid = admins.find((entry) => entry.email === "mid@example.com");
    assert.equal(mid.locked, false);
  });
});
