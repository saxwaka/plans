import { randomUUID } from "node:crypto";
import { getDb } from "../src/lib/db";
import { generateKey } from "../src/lib/gateway/auth";

const args = process.argv.slice(2);
const admin = args.includes("--admin");
const name = args.find((a) => !a.startsWith("--")) ?? "default";
const role = admin ? "admin" : "client";
const { raw, hash, prefix } = generateKey();

getDb()
  .prepare(
    "INSERT INTO client_key (id, name, key_hash, key_prefix, role, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)",
  )
  .run(randomUUID(), name, hash, prefix, role, new Date().toISOString());

console.log(`\n  Key "${name}" (${role}) đã tạo. Chỉ hiện MỘT LẦN — chỉ hash được lưu.\n`);
console.log(`    ${raw}\n`);
console.log(`  /v1  → Base URL http://localhost:3000/v1  ·  API key như trên`);
if (admin) console.log(`  /api → Management API, cùng key. Giữ kỹ: tạo key, xoá pool, chạy verify tốn tiền.`);
console.log();
