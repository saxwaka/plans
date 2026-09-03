import { getDb } from "../db";
import type { GatewayConfig } from "./config";
import { hasVilao } from "./config";

interface VilaoUsageRow {
  id: string;
  provider_id: string;
  model_id: string;
  input_tokens?: number;
  output_tokens?: number;
  total_cost?: number;
  actual_model?: string;
  created_at: string;
}

/**
 * Fills in the cost of Vilao calls.
 *
 * Vilao's OpenAI response reports usage.cost as 0 no matter what; the real
 * figure only exists in the management API. Without this, every Vilao call
 * stays unpriced, which is what made per-pool budgets blind to them.
 *
 * The two sides share no request id — a chat completion's id is unrelated to
 * the usage row's — so runs are matched on provider, model, exact token counts
 * and proximity in time. Each usage row is consumed once, recorded in
 * run.reconciled_from, so a row can never pay for two runs and a rerun of this
 * function is safe.
 */
const MATCH_WINDOW_MS = 15 * 60_000;

export interface ReconcileReport {
  fetched: number;
  matched: number;
  stillUnpriced: number;
}

export async function reconcileVilao(
  config: GatewayConfig,
  pages = 3,
): Promise<ReconcileReport> {
  if (!hasVilao(config)) return { fetched: 0, matched: 0, stillUnpriced: unpricedCount() };

  const rows: VilaoUsageRow[] = [];
  for (let page = 1; page <= pages; page++) {
    const response = await fetch(
      `${config.vilaoManageUrl}/llm/usage?page=${page}&page_size=100`,
      { headers: { Authorization: `Bearer ${config.vilaoPat}` } },
    );
    if (!response.ok) break;
    const body = (await response.json()) as { data?: VilaoUsageRow[] };
    const batch = body.data ?? [];
    rows.push(...batch);
    if (batch.length < 100) break;
  }

  const db = getDb();
  const claimed = new Set(
    (db.prepare("SELECT reconciled_from FROM run WHERE reconciled_from IS NOT NULL").all() as {
      reconciled_from: string;
    }[]).map((r) => r.reconciled_from),
  );

  const candidates = db
    .prepare(
      `SELECT id, listing_id, tokens_in, tokens_out, created_at FROM run
        WHERE platform = 'vilao' AND cost_vnd IS NULL AND status = 'ok'
              AND reconciled_from IS NULL
        ORDER BY created_at DESC LIMIT 500`,
    )
    .all() as { id: string; listing_id: string; tokens_in: number | null; tokens_out: number | null; created_at: string }[];

  const apply = db.prepare(
    "UPDATE run SET cost_vnd = ?, actual_model = COALESCE(actual_model, ?), reconciled_from = ? WHERE id = ?",
  );

  let matched = 0;
  const taken = new Set<string>();

  db.transaction(() => {
    for (const usage of rows) {
      if (claimed.has(usage.id) || usage.total_cost === undefined) continue;
      // listing ids are "vilao:<provider_id>:<model_id>", so the pair is recoverable.
      const wanted = `vilao:${usage.provider_id}:${usage.model_id}`;
      const usageAt = Date.parse(usage.created_at);

      let best: (typeof candidates)[number] | undefined;
      let bestGap = Infinity;
      for (const run of candidates) {
        if (taken.has(run.id) || run.listing_id !== wanted) continue;
        if (run.tokens_in !== (usage.input_tokens ?? null)) continue;
        if (run.tokens_out !== (usage.output_tokens ?? null)) continue;
        const gap = Math.abs(Date.parse(run.created_at) - usageAt);
        if (gap < bestGap && gap <= MATCH_WINDOW_MS) {
          best = run;
          bestGap = gap;
        }
      }

      if (best) {
        apply.run(usage.total_cost, usage.actual_model ?? null, usage.id, best.id);
        taken.add(best.id);
        matched++;
      }
    }
  })();

  return { fetched: rows.length, matched, stillUnpriced: unpricedCount() };
}

function unpricedCount(): number {
  return (
    getDb()
      .prepare("SELECT COUNT(*) AS n FROM run WHERE status = 'ok' AND cost_vnd IS NULL")
      .get() as { n: number }
  ).n;
}

let pending: NodeJS.Timeout | null = null;

/**
 * Nudges a reconcile a few seconds after a Vilao call, so costs land on their
 * own rather than waiting for someone to open a page. Calls coalesce, failures
 * are swallowed — this is a convenience, and the manual run stays authoritative.
 */
export function scheduleReconcile(config: GatewayConfig): void {
  if (pending || !hasVilao(config)) return;
  pending = setTimeout(() => {
    pending = null;
    reconcileVilao(config, 1).catch(() => {});
  }, 5_000);
  pending.unref?.();
}
