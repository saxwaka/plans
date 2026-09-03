import {
  actionCreatePool,
  actionDeletePool,
  actionMoveMember,
  actionRemoveMember,
  actionMemberState,
  actionSetRule,
  actionSetWeight,
  actionUpdatePool,
  actionVerifyPool,
  syncCatalog,
} from "../actions";
import { poolSpend } from "@/lib/gateway/budget";
import { estimatedCost, reliability } from "@/lib/gateway/routing";
import { btn, c, input, Nav, Td, Th, vnd } from "../ui";
import { candidates, getRule, listPools, poolMembers } from "@/lib/gateway/pool";
import { measuredStats } from "@/lib/gateway/stats";
import { lastProbes, verifyEstimate } from "@/lib/gateway/verify";
import { countAll } from "@/lib/gateway/filter";

export const dynamic = "force-dynamic";

export default function Pools() {
  const pools = listPools();
  const catalogSize = countAll();
  const stats = measuredStats();

  return (
    <main style={{ maxWidth: 1200, margin: "0 auto" }}>
      <Nav here="/pools" />

      <form action={actionCreatePool} style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem" }}>
        <input style={{ ...input, width: 200 }} name="name" placeholder="tên pool, vd: opus" required />
        <select style={btn} name="strategy" defaultValue="failover">
          <option value="failover">failover</option>
        </select>
        <button style={btn} type="submit">tạo pool</button>
        <form action={syncCatalog}>
          <button style={btn} type="submit">sync catalog ({catalogSize})</button>
        </form>
      </form>

      <p style={{ fontSize: "0.75rem", color: c.dim, marginBottom: "1.5rem", lineHeight: 1.6 }}>
        Tên pool chính là tên model client gọi. Thành viên chạy theo thứ tự từ trên xuống —
        đặt listing rẻ lên đầu và listing đắt-nhưng-chắc xuống cuối làm lưới an toàn.
        <br />
        Hỏng ở thành viên #1 thì tự tụt xuống #2 — nhưng chỉ khi lỗi <em>đáng thử lại</em>
        và chỉ <em>trước</em> khi byte đầu tiên rời server. Lỗi 400 do prompt sai không thử lại,
        vì sàn nào cũng hỏng như nhau, thử lại chỉ tốn tiền.
      </p>

      {pools.length === 0 && (
        <p style={{ color: c.dim, fontSize: "0.8rem" }}>
          Chưa có pool nào. Tạo một cái, rồi sang <a href="/catalog" style={{ color: c.accent }}>catalog</a> thêm thành viên.
        </p>
      )}

      {pools.map((pool) => {
        const members = poolMembers(pool.id);
        const p = pool as typeof pool & {
          max_attempts?: number;
          daily_budget?: number | null;
          monthly_budget?: number | null;
          max_price_per_request?: number | null;
        };
        const spend = poolSpend(pool.id);
        const rule = getRule(pool.id);
        const queue = candidates(pool.id);
        const probes = lastProbes(pool.id);
        const estimate = verifyEstimate(pool.id, true);
        return (
          <section key={pool.id} style={{ marginBottom: "2.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.8rem", marginBottom: "0.6rem" }}>
              <h2 style={{ fontSize: "0.95rem", margin: 0 }}>{pool.name}</h2>
              <span style={{ color: c.dim, fontSize: "0.72rem" }}>
                {pool.strategy} · {members.length} thành viên
              </span>
              <form action={actionVerifyPool} style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                <input type="hidden" name="poolId" value={pool.id} />
                <input type="hidden" name="includeCandidates" value="1" />
                <button style={btn} type="submit" disabled={estimate.members === 0}>
                  kiểm tra pool
                </button>
                {/* Quote the price first. A one-token probe is not a cheap probe:
                    billing is max(floor, per-request + tokens), so a sweep costs
                    the sum of the members' floors, not a rounding error. It is an
                    upper bound — a listing that fails is not billed, and a measured
                    sweep of 18 came to 207₫ against a 338₫ quote. */}
                <span
                  style={{ fontSize: "0.7rem", color: c.warn }}
                  title="Gọi thật, tốn tiền thật. Listing hỏng thì không bị tính, nên số thực trả thường thấp hơn."
                >
                  {estimate.members} listing · tối đa {vnd(estimate.cost)}₫
                </span>
              </form>
              <form action={actionDeletePool}>
                <input type="hidden" name="poolId" value={pool.id} />
                <button style={{ ...btn, color: c.bad }} type="submit">xoá pool</button>
              </form>
            </div>

            <form
              action={actionUpdatePool}
              style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", alignItems: "center", marginBottom: "0.8rem" }}
            >
              <input type="hidden" name="poolId" value={pool.id} />
              <select style={btn} name="strategy" defaultValue={pool.strategy}>
                <option value="failover">failover (thứ tự bạn đặt)</option>
                <option value="cheapest">cheapest (rẻ nhất đã kiểm chứng)</option>
                <option value="round-robin">round-robin</option>
                <option value="weighted">weighted</option>
                <option value="pinned">pinned</option>
              </select>
              <label style={{ fontSize: "0.7rem", color: c.dim }}>
                thử tối đa{" "}
                <input style={{ ...input, width: 44 }} name="maxAttempts" defaultValue={p.max_attempts ?? 3} />
              </label>
              <input style={{ ...input, width: 110 }} name="dailyBudget" placeholder="trần ngày ₫" defaultValue={p.daily_budget ?? ""} />
              <input style={{ ...input, width: 118 }} name="monthlyBudget" placeholder="trần tháng ₫" defaultValue={p.monthly_budget ?? ""} />
              <input style={{ ...input, width: 128 }} name="maxPricePerRequest" placeholder="≤ ₫/request" defaultValue={p.max_price_per_request ?? ""} />
              <button style={btn} type="submit">lưu</button>
              <span style={{ fontSize: "0.7rem", color: c.dim }}>
                hôm nay {vnd(spend.today)}₫
                {spend.wastedToday > 0 && (
                  <span style={{ color: c.warn }}> · lãng phí {vnd(spend.wastedToday)}₫</span>
                )}
                {/* A budget can only stop spending it can see. Vilao reports no cost
                    inline, so a Vilao-heavy pool would sail past its cap in silence —
                    say so rather than implying the cap is enforced. */}
                {spend.unpricedToday > 0 && (p.daily_budget || p.monthly_budget) && (
                  <span style={{ color: c.bad }}>
                    {" "}· trần KHÔNG tính được {spend.unpricedToday} request Vilao
                  </span>
                )}
              </span>
            </form>

            <details style={{ marginBottom: "0.8rem" }}>
              <summary style={{ fontSize: "0.72rem", color: c.dim, cursor: "pointer" }}>
                luật tự nhận thành viên {rule ? "· đang bật" : "· tắt"}
                {queue.length > 0 && (
                  <span style={{ color: c.warn }}> · {queue.length} chờ duyệt</span>
                )}
              </summary>
              <form action={actionSetRule} style={{ marginTop: "0.5rem" }}>
                <input type="hidden" name="poolId" value={pool.id} />
                <textarea
                  name="ruleJson"
                  rows={3}
                  placeholder='{"platform":"ckey","search":"opus","maxPriceIn":500}'
                  defaultValue={rule ? JSON.stringify(rule.filter) : ""}
                  style={{ ...input, width: "100%", fontFamily: "inherit", cursor: "text" }}
                />
                <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", marginTop: "0.4rem" }}>
                  <label style={{ fontSize: "0.7rem", color: c.dim }}>
                    <input type="checkbox" name="autoAdmit" value="1" defaultChecked={rule?.autoAdmit} />{" "}
                    tự nhận thẳng (bỏ hàng chờ duyệt)
                  </label>
                  <button style={btn} type="submit">lưu luật</button>
                </div>
              </form>
            </details>

            {queue.length > 0 && (
              <div style={{ marginBottom: "0.8rem", fontSize: "0.74rem" }}>
                <div style={{ color: c.warn, marginBottom: "0.3rem" }}>
                  {queue.length} listing khớp luật, chờ bạn duyệt:
                </div>
                {queue.slice(0, 12).map((q) => (
                  <div key={q.id} style={{ display: "flex", gap: "0.5rem", alignItems: "center", padding: "0.15rem 0" }}>
                    <span style={{ minWidth: 300 }}>
                      {q.platform} · {q.display_name} · in={vnd(q.price_in)}
                    </span>
                    <span style={{ minWidth: 110 }}>{probeCell(probes.get(q.id))}</span>
                    <StateButton poolId={pool.id} listingId={q.id} state="active" label="nhận" />
                    <StateButton poolId={pool.id} listingId={q.id} state="blocked" label="chặn" />
                  </div>
                ))}
              </div>
            )}

            {members.length === 0 ? (
              <p style={{ color: c.warn, fontSize: "0.75rem" }}>
                Pool rỗng — gọi tên này sẽ trả 409. Thêm thành viên từ catalog.
              </p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.76rem" }}>
                <thead>
                  <tr style={{ textAlign: "left", color: c.dim }}>
                    <Th>#</Th><Th>Sàn</Th><Th>Người bán</Th><Th>Model</Th>
                    <Th>In</Th><Th>Out</Th><Th>/req</Th><Th>Success</Th><Th>Request</Th>
                    <Th>Ước tính</Th><Th>Điểm</Th><Th>Kiểm tra</Th><Th>W</Th><Th />
                  </tr>
                </thead>
                <tbody>
                  {members.map((m, i) => (
                    <tr key={m.id} style={{ borderTop: `1px solid ${c.line}` }}>
                      <Td>
                        <span style={{ color: i === 0 ? c.ok : c.dim }}>{i + 1}</span>
                      </Td>
                      <Td>{m.platform}</Td>
                      <Td>{m.seller ?? "—"}</Td>
                      <Td>
                        {m.display_name}
                        {m.stale === 1 && <span style={{ color: c.warn }}> (stale)</span>}
                      </Td>
                      <Td>{vnd(m.price_in)}</Td>
                      <Td>{vnd(m.price_out)}</Td>
                      <Td>{vnd(m.price_request)}</Td>
                      <Td>
                        {m.success_rate !== null ? (
                          `${m.success_rate.toFixed(1)}%`
                        ) : stats.get(m.id) ? (
                          // CKey publishes nothing, so anything shown here the
                          // gateway measured for itself.
                          <span style={{ color: c.accent }} title="gateway tự đo">
                            ~{(
                              (1 - (stats.get(m.id)!.failures / stats.get(m.id)!.calls)) * 100
                            ).toFixed(0)}
                            % ({stats.get(m.id)!.calls})
                          </span>
                        ) : (
                          <span style={{ color: c.dim }}>chưa đo</span>
                        )}
                      </Td>
                      <Td>{m.total_requests?.toLocaleString("vi-VN") ?? "—"}</Td>
                      {/* Estimated cost of one typical call, and that cost divided by
                          reliability — the number the router actually compares. */}
                      <Td>{vnd(estimatedCost(m))}₫</Td>
                      <Td>
                        <span style={{ color: c.dim }} title="giá ước tính chia cho độ tin cậy">
                          {(estimatedCost(m) / reliability(m, stats.get(m.id))).toFixed(1)}
                        </span>
                      </Td>
                      <Td>{probeCell(probes.get(m.id))}</Td>
                      <Td>
                        <form action={actionSetWeight} style={{ display: "flex", gap: 2 }}>
                          <input type="hidden" name="poolId" value={pool.id} />
                          <input type="hidden" name="listingId" value={m.id} />
                          <input style={{ ...input, width: 40 }} name="weight" defaultValue={m.weight} />
                        </form>
                      </Td>
                      <Td>
                        <span style={{ display: "flex", gap: 4 }}>
                          <Move poolId={pool.id} listingId={m.id} direction={-1} label="↑" />
                          <Move poolId={pool.id} listingId={m.id} direction={1} label="↓" />
                          <form action={actionRemoveMember}>
                            <input type="hidden" name="poolId" value={pool.id} />
                            <input type="hidden" name="listingId" value={m.id} />
                            <button style={btn} type="submit">×</button>
                          </form>
                        </span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        );
      })}
    </main>
  );
}

/** Latest verify outcome for one listing: green with latency, or the failure. */
function probeCell(probe: ReturnType<typeof lastProbes> extends Map<string, infer T> ? T | undefined : never) {
  if (!probe) return <span style={{ color: c.dim }}>—</span>;
  if (probe.status === "ok") {
    return (
      <span style={{ color: c.ok }} title={probe.created_at}>
        ok {probe.latency_ms ? `${(probe.latency_ms / 1000).toFixed(1)}s` : ""}
      </span>
    );
  }
  return (
    <span style={{ color: c.bad }} title={probe.created_at}>
      {probe.error_code ?? "hỏng"}
    </span>
  );
}

function StateButton({
  poolId,
  listingId,
  state,
  label,
}: {
  poolId: string;
  listingId: string;
  state: string;
  label: string;
}) {
  return (
    <form action={actionMemberState}>
      <input type="hidden" name="poolId" value={poolId} />
      <input type="hidden" name="listingId" value={listingId} />
      <input type="hidden" name="state" value={state} />
      <button style={btn} type="submit">{label}</button>
    </form>
  );
}

function Move({
  poolId,
  listingId,
  direction,
  label,
}: {
  poolId: string;
  listingId: string;
  direction: -1 | 1;
  label: string;
}) {
  return (
    <form action={actionMoveMember}>
      <input type="hidden" name="poolId" value={poolId} />
      <input type="hidden" name="listingId" value={listingId} />
      <input type="hidden" name="direction" value={direction} />
      <button style={btn} type="submit">{label}</button>
    </form>
  );
}
