import { getDb } from "../db";

export interface PoolSpend {
  today: number;
  month: number;
  /** Money spent on attempts that produced nothing — the price of falling back. */
  wastedToday: number;
  /** Successful calls today whose cost never arrived, so budgets cannot see them. */
  unpricedToday: number;
}

function startOfDay(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function startOfMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function poolSpend(poolId: string): PoolSpend {
  const db = getDb();
  const sum = (since: string, onlyFailed: boolean) =>
    (
      db
        .prepare(
          `SELECT COALESCE(SUM(cost_vnd), 0) AS total FROM run
            WHERE pool_id = ? AND created_at >= ?${onlyFailed ? " AND status <> 'ok'" : ""}`,
        )
        .get(poolId, since) as { total: number }
    ).total;

  const unpriced = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM run
          WHERE pool_id = ? AND created_at >= ? AND status = 'ok' AND cost_vnd IS NULL`,
      )
      .get(poolId, startOfDay()) as { n: number }
  ).n;

  return {
    today: sum(startOfDay(), false),
    month: sum(startOfMonth(), false),
    wastedToday: sum(startOfDay(), true),
    unpricedToday: unpriced,
  };
}

export interface BudgetVerdict {
  allowed: boolean;
  reason?: string;
}

/**
 * Budgets are checked before dispatch, never after. A pool that has hit its cap
 * refuses rather than quietly spending more — and because Vilao does not report
 * cost inline, its calls stay unpriced until M5 reconciles them, which means
 * these caps currently see CKey spend only. Stated here so the gap is not
 * mistaken for a working guarantee.
 */
export function checkBudget(
  poolId: string,
  dailyBudget: number | null,
  monthlyBudget: number | null,
): BudgetVerdict {
  if (dailyBudget === null && monthlyBudget === null) return { allowed: true };

  const spend = poolSpend(poolId);
  if (dailyBudget !== null && spend.today >= dailyBudget) {
    return { allowed: false, reason: `Trần ngày ${dailyBudget}₫ đã dùng hết (${spend.today.toFixed(0)}₫).` };
  }
  if (monthlyBudget !== null && spend.month >= monthlyBudget) {
    return { allowed: false, reason: `Trần tháng ${monthlyBudget}₫ đã dùng hết (${spend.month.toFixed(0)}₫).` };
  }
  return { allowed: true };
}
