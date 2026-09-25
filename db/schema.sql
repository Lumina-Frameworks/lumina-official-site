-- Lumina Frameworks CMS schema
-- Apply: npx wrangler d1 execute lumina-cms --file=./db/schema.sql --remote

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
