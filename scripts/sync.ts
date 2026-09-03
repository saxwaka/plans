import { loadConfig, hasVilao } from "../src/lib/gateway/config";
import { syncAll } from "../src/lib/gateway/catalog";

const config = loadConfig();
if (!hasVilao(config)) {
  console.log("Vilao chưa cấu hình (VILAO_API_KEY + VILAO_PAT) — chỉ sync CKey.");
}

for (const report of await syncAll(config)) {
  if (report.error) console.log(`  ${report.platform}: LỖI — ${report.error}`);
  else console.log(`  ${report.platform}: ${report.seen} listing, ${report.markedStale} đánh dấu stale`);
}
