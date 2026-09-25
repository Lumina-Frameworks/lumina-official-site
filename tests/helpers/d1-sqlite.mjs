/**
 * A minimal D1-shaped wrapper over node:sqlite, for running Pages Functions
 * against a real database without Wrangler.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function makeD1(sqlite) {
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

/** In-memory database with db/schema.sql and db/seed.sql already applied. */
export function seededDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(fs.readFileSync(path.join(ROOT, "db", "schema.sql"), "utf8"));
  sqlite.exec(fs.readFileSync(path.join(ROOT, "db", "seed.sql"), "utf8"));
  return sqlite;
}
