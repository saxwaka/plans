import { createHash, timingSafeEqual } from "node:crypto";
import { randomBytes } from "node:crypto";
import { getDb } from "../db";

export interface ClientKey {
  id: string;
  name: string;
}

export function hashKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function generateKey(): { raw: string; hash: string; prefix: string } {
  const raw = `gw-${randomBytes(24).toString("hex")}`;
  return { raw, hash: hashKey(raw), prefix: `${raw.slice(0, 7)}…${raw.slice(-4)}` };
}

/** Reads the bearer token off a request and resolves it to an active client key. */
export function authenticate(authorization: string | null): ClientKey | null {
  const raw = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!raw) return null;

  const candidate = Buffer.from(hashKey(raw), "hex");
  const rows = getDb()
    .prepare<[], { id: string; name: string; key_hash: string }>(
      "SELECT id, name, key_hash FROM client_key WHERE active = 1",
    )
    .all();

  // Compare against every active key with a constant-time check rather than
  // letting SQLite match on the hash, so a lookup cannot be timed.
  for (const row of rows) {
    const stored = Buffer.from(row.key_hash, "hex");
    if (stored.length === candidate.length && timingSafeEqual(stored, candidate)) {
      return { id: row.id, name: row.name };
    }
  }
  return null;
}
