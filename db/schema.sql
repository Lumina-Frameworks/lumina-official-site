-- Lumina Frameworks CMS schema
-- Apply: npx wrangler d1 execute lumina-cms --file=./db/schema.sql --remote
-- Every statement is idempotent, so this file can be re-run on a live database.

CREATE TABLE IF NOT EXISTS projects (
  slug       TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  symbol     TEXT NOT NULL,
  category   TEXT NOT NULL,
  year       INTEGER NOT NULL,
  image_url  TEXT,
  blurb      TEXT NOT NULL,
  tagline    TEXT,
  stack      TEXT NOT NULL DEFAULT '[]',
  tags       TEXT NOT NULL DEFAULT '[]',
  url        TEXT,
  featured   INTEGER NOT NULL DEFAULT 0,
  published  INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_projects_published
  ON projects (published, sort_order, year DESC);

CREATE INDEX IF NOT EXISTS idx_projects_featured
  ON projects (featured, sort_order);

-- ---------------------------------------------------------------------------
-- Admin roster
--
-- ADMIN_EMAILS in the environment stays the bootstrap/break-glass allowlist:
-- those addresses are always owners and cannot be removed from the console.
-- Everyone else is granted here, so access is managed without a redeploy.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS admins (
  email      TEXT PRIMARY KEY,
  name       TEXT,
  picture    TEXT,
  role       TEXT NOT NULL DEFAULT 'admin',   -- owner | admin | viewer
  status     TEXT NOT NULL DEFAULT 'active',  -- active | suspended
  note       TEXT,
  added_by   TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen  TEXT,
  login_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_admins_role ON admins (role, status);

-- ---------------------------------------------------------------------------
-- Sessions
--
-- The session cookie carries a `sid` claim that must match an active row here.
-- That makes revocation immediate (sign out everywhere, suspend an admin)
-- instead of waiting out the cookie's 7-day life.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  name       TEXT,
  picture    TEXT,
  role       TEXT NOT NULL,
  login_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen  TEXT NOT NULL DEFAULT (datetime('now')),
  user_agent TEXT,
  device     TEXT,
  browser    TEXT,
  os         TEXT,
  ip_hash    TEXT,
  country    TEXT,
  status     TEXT NOT NULL DEFAULT 'active'   -- active | revoked
);

CREATE INDEX IF NOT EXISTS idx_sessions_email ON sessions (email, status, login_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_login ON sessions (login_at DESC);
-- ---------------------------------------------------------------------------
-- Audit log
--
-- One row per mutation worth being able to explain later: who, what, which
-- record, from where, on what device, and the before/after diff in `details`.
-- `ip_hash` is a salted digest, never the raw address.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  actor      TEXT NOT NULL,
  actor_role TEXT,
  action     TEXT NOT NULL,   -- project.create, auth.login, session.revoke, ...
  status     TEXT NOT NULL DEFAULT 'ok',  -- ok | denied | failed
  entity     TEXT,            -- project | session | admin | audit
  entity_id  TEXT,
  summary    TEXT,
  method     TEXT,
  path       TEXT,
  ip_hash    TEXT,
  country    TEXT,
  city       TEXT,
  user_agent TEXT,
  device     TEXT,
  browser    TEXT,
  os         TEXT,
  details    TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log (actor, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log (action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_status ON audit_log (status, created_at DESC);

-- ---------------------------------------------------------------------------
-- Bootstrap: the environment allowlist starts out as owners, from the same
-- single source of truth (wrangler.toml / Pages env). Only runs when the
-- roster is still empty, so it never resurrects a removed admin.
-- ---------------------------------------------------------------------------

INSERT INTO admins (email, name, role, status, note)
SELECT lower(trim(value)), NULL, 'owner', 'active', 'Bootstrapped from ADMIN_EMAILS'
FROM json_each('["amirhafizi443@gmail.com","aliffprime3@gmail.com"]')
WHERE (SELECT COUNT(*) FROM admins) = 0;
