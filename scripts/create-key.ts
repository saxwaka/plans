import { randomUUID } from "node:crypto";
import { getDb } from "../src/lib/db";
import { generateKey } from "../src/lib/gateway/auth";

const name = process.argv[2] ?? "default";
const { raw, hash, prefix } = generateKey();

getDb()
  .prepare("INSERT INTO client_key (id, name, key_hash, key_prefix, active, created_at) VALUES (?, ?, ?, ?, 1, ?)")
  .run(randomUUID(), name, hash, prefix, new Date().toISOString());

console.log(`\n  Key "${name}" đã tạo. Chỉ hiện MỘT LẦN — chỉ hash được lưu.\n`);
console.log(`    ${raw}\n`);
console.log(`  Dùng: Base URL http://localhost:3000/v1  ·  API key như trên\n`);
