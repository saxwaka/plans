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
];

function migrate(handle: Database.Database): void {
  for (const [table, column, definition] of ADDITIONS) {
    const columns = handle.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!columns.some((c) => c.name === column)) {
      handle.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
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
