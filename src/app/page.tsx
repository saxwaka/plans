import { isModelMismatch } from "@/lib/gateway/modelname";
import { probeFailureCount, recentRuns, spendToday } from "@/lib/gateway/runlog";
import { Badge, Shell, Stat, secs, vnd } from "./ui";

export const dynamic = "force-dynamic";

export default function Dashboard() {
  const today = spendToday();
  const runs = recentRuns(60);
  // Verify sweeps deliberately call listings that are down, so counting them
  // here would report the gateway as failing when it is not.
  const live = today.calls - today.probes;
  const liveFailures = today.failures - probeFailureCount();
  const okRate = live <= 0 ? null : ((live - liveFailures) / live) * 100;

  return (
    <Shell here="/">
      <div className="stats">
        <Stat
          label="Chi hôm nay"
          value={vnd(today.total)}
          unit="₫"
          // Never let the total look complete when it is not: an unreconciled
          // Vilao call is counted but not yet priced.
          hint={today.unpriced > 0 ? `chưa gồm ${today.unpriced} request chưa đối soát` : undefined}
          tone={today.unpriced > 0 ? "warn" : undefined}
        />
        <Stat
          label="Request"
          value={String(live)}
          hint={today.probes > 0 ? `+ ${today.probes} lượt kiểm tra pool` : "hôm nay"}
        />
        <Stat
          label="Thành công"
          value={okRate === null ? "—" : `${okRate.toFixed(0)}%`}
          hint={okRate === null ? "chưa có traffic thật" : "không tính lượt kiểm tra"}
          tone={okRate !== null && okRate < 90 ? "bad" : "ok"}
        />
        {/* Falling back is not free: a failed attempt can still be billed. */}
        <Stat
          label="Lãng phí"
          value={vnd(today.wasted)}
          unit="₫"
          hint="trả cho lần thử hỏng"
          tone={today.wasted > 0 ? "warn" : undefined}
        />
      </div>

      <h2 className="section">Request gần đây</h2>
      <div className="tablewrap scroll">
        <table>
          <thead>
            <tr>
              <th>Lúc</th>
              <th>Model</th>
              <th>Kiểu</th>
              <th className="num">Vào</th>
              <th className="num">Ra</th>
              <th className="num">Tiền</th>
              <th className="num">Đầu tiên</th>
              <th className="num">Tổng</th>
              <th>Kết quả</th>
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 && (
              <tr>
                <td className="empty" colSpan={9}>Chưa có request nào.</td>
              </tr>
            )}
            {runs.map((r) => (
              <tr key={r.id}>
                <td className="mono faint">{new Date(r.created_at).toLocaleTimeString("vi-VN")}</td>
                <td className="mono">
                  {r.requested_model}
                  {/* Only show what served when it is genuinely different. A pool
                      resolving to a member is informative and reads plainly; a
                      listing asked for by name that answered as something else is
                      the warning this was built for. Dropping a seller prefix is
                      neither, and printing it on every row is just noise. */}
                  {isModelMismatch(r.requested_model, r.actual_model) &&
                    (r.pool_id ? (
                      <span className="faint"> → {r.actual_model}</span>
                    ) : (
                      <span style={{ color: "var(--warn)" }} title="người bán trả về model khác">
                        {" "}→ {r.actual_model}
                      </span>
                    ))}
                </td>
                <td>
                  {r.kind === "probe" ? (
                    <Badge tone="neutral" title="lượt kiểm tra pool, không phải traffic thật">
                      kiểm tra
                    </Badge>
                  ) : (
                    <span className="faint">{r.stream ? "stream" : "sync"}</span>
                  )}
                  {r.attempt_no > 1 && (
                    <>
                      {" "}
                      <Badge tone="warn" title="lần thử fallback">#{r.attempt_no}</Badge>
                    </>
                  )}
                </td>
                <td className="num mono">{r.tokens_in ?? "—"}</td>
                <td className="num mono">{r.tokens_out ?? "—"}</td>
                <td className="num mono">{vnd(r.cost_vnd)}</td>
                <td className="num mono faint">{r.ttfb_ms ? `${r.ttfb_ms}ms` : "—"}</td>
                <td className="num mono faint">{secs(r.latency_ms)}</td>
                <td>
                  {r.status === "ok" ? (
                    <Badge tone="ok">ok</Badge>
                  ) : (
                    <Badge tone="bad">{r.error_code ?? r.status}</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
