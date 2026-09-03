import Database from "better-sqlite3";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

let db: Database.Database | null = null;

/** Columns added after a database already exists. CREATE TABLE IF NOT EXISTS
 *  will not add them, so each is applied individually and idempotently. */
const ADDITIONS: [table: string, column: string, definition: string][] = [
  ["pool", "daily_budget", "REAL"],
  ["pool", "monthly_budget", "REAL"],
  ["pool", "max_price_per_request", "REAL"],
  ["pool", "max_attempts", "INTEGER NOT NULL DEFAULT 3"],
  ["pool", "ttfb_timeout_ms", "INTEGER"],
  ["pool", "total_timeout_ms", "INTEGER"],
  // Vilao usage row this run's cost came from; also stops one row paying for two runs.
  ["run", "reconciled_from", "TEXT"],
  ["pool", "rule_json", "TEXT"],
  ["pool", "auto_admit", "INTEGER NOT NULL DEFAULT 0"],
  // 'live' for real traffic, 'probe' for a verify run — same evidence, different money.
  ["run", "kind", "TEXT NOT NULL DEFAULT 'live'"],
  // Which API surface served the run: chat, messages, embeddings, responses…
  ["run", "endpoint", "TEXT"],
  // 'client' may call /v1; 'admin' may also drive the management API under /api.
  ["client_key", "role", "TEXT NOT NULL DEFAULT 'client'"],
];

function migrate(handle: Database.Database): void {
  for (const [table, column, definition] of ADDITIONS) {
    const columns = handle.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!columns.some((c) => c.name === column)) {
      handle.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  // Early runs logged listing_id as the bare upstream model name, before pools
  // introduced the "<platform>:<id>" form. Left alone, one listing shows up as
  // two rows in usage and — worse — its evidence is split across two keys, so
  // reliability scoring sees half the calls it should.
  handle
    .prepare(
      `UPDATE run SET listing_id = platform || ':' || listing_id
        WHERE listing_id IS NOT NULL
          AND listing_id NOT LIKE 'ckey:%'
          AND listing_id NOT LIKE 'vilao:%'`,
    )
    .run();
}

export function getDb(): Database.Database {
  if (db) return db;

  const path = process.env.DATABASE_PATH ?? "./data/gateway.db";
  mkdirSync(dirname(path), { recursive: true });

  db = new Database(path);
  // WAL so a write never blocks a concurrent read. better-sqlite3 is synchronous,
  // so callers must still keep writes off the streaming path.
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.exec(readFileSync(join(process.cwd(), "src/lib/db/schema.sql"), "utf8"));
  migrate(db);
  return db;
}
