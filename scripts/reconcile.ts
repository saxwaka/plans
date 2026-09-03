import { loadConfig } from "../src/lib/gateway/config";
import { reconcileVilao } from "../src/lib/gateway/reconcile";

const report = await reconcileVilao(loadConfig(), 5);
console.log(
  `  đọc ${report.fetched} bản ghi usage · ghép được ${report.matched} · còn ${report.stillUnpriced} run chưa rõ giá`,
);
