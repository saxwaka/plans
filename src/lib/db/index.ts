import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

let db: Database.Database | null = null;

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
  return db;
}
