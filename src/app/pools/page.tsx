import {
  actionCreatePool,
  actionDeletePool,
  actionMemberState,
  actionMoveMember,
  actionSetPosition,
  actionSetRule,
  actionSetWeight,
  actionToggleMember,
  actionUpdatePool,
  actionVerifyPool,
  syncCatalog,
} from "../actions";
import { Badge, Shell, secs, vnd } from "../ui";
import { poolSpend } from "@/lib/gateway/budget";
import { countAll } from "@/lib/gateway/filter";
import { candidates, chainMembers, getRule, listPools, type PoolMember } from "@/lib/gateway/pool";
import { estimatedCost, reliability } from "@/lib/gateway/routing";
import { measuredStats } from "@/lib/gateway/stats";
import { lastProbes, verifyEstimate } from "@/lib/gateway/verify";

export const dynamic = "force-dynamic";

export default function Pools() {
  const pools = listPools();
  const catalogSize = countAll();
  const stats = measuredStats();

  return (
    <Shell here="/pools">
      <div className="card toolbar" style={{ marginBottom: 16 }}>
        <form action={actionCreatePool} className="toolbar">
          <input name="name" placeholder="tên pool, vd: opus" required style={{ width: 200 }} />
          <select name="strategy" defaultValue="failover">
            <option value="failover">failover</option>
            <option value="cheapest">cheapest</option>
          </select>
          <button className="btn primary" type="submit">Tạo pool</button>
        </form>
        <form action={syncCatalog}>
          <button className="btn" type="submit">
            Đồng bộ danh mục ({catalogSize.toLocaleString("vi-VN")})
          </button>
        </form>
      </div>

      <p className="note" style={{ marginBottom: 26 }}>
        Tên pool chính là tên model client gọi. Thành viên chạy theo thứ tự từ trên xuống — đặt
        listing rẻ lên đầu, listing <em>đắt nhưng chắc</em> xuống cuối làm lưới an toàn. Hỏng ở
        thành viên đầu thì tự tụt xuống dưới, nhưng chỉ khi lỗi <em>đáng thử lại</em> và chỉ{" "}
        <em>trước</em> khi byte đầu tiên rời server.
      </p>

      {pools.length === 0 && (
        <div className="card">
          <p className="note" style={{ margin: 0 }}>
            Chưa có pool nào. Tạo một cái ở trên, rồi sang <a href="/catalog">danh mục</a> thêm
            thành viên.
          </p>
        </div>
      )}

      {pools.map((pool) => {
        // The chain includes disabled members: hiding a listing you switched off
        // would leave no way to switch it back on.
        const members = chainMembers(pool.id);
        const active = members.filter((m) => m.state === "active").length;
        const spend = poolSpend(pool.id);
        const rule = getRule(pool.id);
        const queue = candidates(pool.id);
        const probes = lastProbes(pool.id);
        const estimate = verifyEstimate(pool.id, true);
        const settings = pool as typeof pool & {
          max_attempts?: number;
          daily_budget?: number | null;
          monthly_budget?: number | null;
          max_price_per_request?: number | null;
        };

        return (
          <section className="pool" key={pool.id}>
            <div className="poolhead">
              <span className="name">{pool.name}</span>
              <Badge tone="accent">{pool.strategy}</Badge>
              <Badge tone="ok">{active} bật</Badge>
              {members.length > active && <Badge tone="neutral">{members.length - active} tắt</Badge>}
              <span style={{ flex: 1 }} />
              <form action={actionVerifyPool} className="toolbar">
                <input type="hidden" name="poolId" value={pool.id} />
                <input type="hidden" name="includeCandidates" value="1" />
                <button className="btn" type="submit" disabled={estimate.members === 0}>
                  Kiểm tra {estimate.members} listing
                </button>
                {/* Quote the price first. A one-token probe is not a cheap probe:
                    billing is max(floor, per-request + tokens), so a sweep costs
                    the sum of the floors. It is an upper bound — a listing that
                    fails is not billed. */}
                <Badge tone="warn" title="Gọi thật, tốn tiền thật. Listing hỏng thì không bị tính, nên số thực trả thường thấp hơn.">
                  tối đa {vnd(estimate.cost)} ₫
                </Badge>
              </form>
              <form action={actionDeletePool}>
                <input type="hidden" name="poolId" value={pool.id} />
                <button className="btn danger" type="submit">Xoá</button>
              </form>
            </div>

            <form action={actionUpdatePool} className="card toolbar" style={{ marginBottom: 12 }}>
              <input type="hidden" name="poolId" value={pool.id} />
              <select name="strategy" defaultValue={pool.strategy}>
                <option value="failover">failover — thứ tự bạn đặt</option>
                <option value="cheapest">cheapest — rẻ nhất đã kiểm chứng</option>
                <option value="round-robin">round-robin — chia đều lượt</option>
                <option value="weighted">weighted — theo trọng số</option>
                <option value="pinned">pinned — ghim thành viên đầu</option>
              </select>
              <label className="check" style={{ gap: 5 }}>
                <span className="faint">thử tối đa</span>
                <input name="maxAttempts" defaultValue={settings.max_attempts ?? 3} style={{ width: 46 }} />
              </label>
              <label className="check" style={{ gap: 5 }}>
                <span className="faint">trần ngày</span>
                <input name="dailyBudget" defaultValue={settings.daily_budget ?? ""} style={{ width: 84 }} />
                <span className="faint">₫</span>
              </label>
              <label className="check" style={{ gap: 5 }}>
                <span className="faint">trần tháng</span>
                <input name="monthlyBudget" defaultValue={settings.monthly_budget ?? ""} style={{ width: 84 }} />
                <span className="faint">₫</span>
              </label>
              <label className="check" style={{ gap: 5 }}>
                <span className="faint">≤ mỗi request</span>
                <input
                  name="maxPricePerRequest"
                  defaultValue={settings.max_price_per_request ?? ""}
                  style={{ width: 72 }}
                />
                <span className="faint">₫</span>
              </label>
              <button className="btn" type="submit">Lưu</button>
              <span style={{ flex: 1 }} />
              <span className="faint" style={{ fontSize: 12 }}>
                hôm nay {vnd(spend.today)} ₫
              </span>
              {spend.wastedToday > 0 && <Badge tone="warn">lãng phí {vnd(spend.wastedToday)} ₫</Badge>}
              {/* A budget can only stop spending it can see. Vilao reports no cost
                  inline, so a Vilao-heavy pool would sail past its cap in silence. */}
              {spend.unpricedToday > 0 && (settings.daily_budget || settings.monthly_budget) && (
                <Badge tone="bad">trần chưa tính {spend.unpricedToday} request Vilao</Badge>
              )}
            </form>

            {members.length === 0 ? (
              <div className="card">
                <span className="note">Pool rỗng — gọi tên này sẽ trả 409. Thêm thành viên từ danh mục.</span>
              </div>
            ) : (
              <div className="tablewrap scroll">
                <table>
                  <thead>
                    <tr>
                      <th className="num">Vị trí</th>
                      <th>Bật</th>
                      <th>Sàn</th>
                      <th>Người bán</th>
                      <th>Model</th>
                      <th className="num">Vào</th>
                      <th className="num">Ra</th>
                      <th>Thành công</th>
                      <th className="num">Ước tính</th>
                      <th className="num">Điểm</th>
                      <th>Kiểm tra</th>
                      <th className="num">Trọng số</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m, i) => (
                      <tr key={m.id} className={m.state === "active" ? undefined : "off"}>
                        <td className="num">
                          {/* Typing a number beats clicking the arrow eight times
                              once a pool has more than a handful of members. */}
                          <form action={actionSetPosition}>
                            <input type="hidden" name="poolId" value={pool.id} />
                            <input type="hidden" name="listingId" value={m.id} />
                            <input
                              className="pos"
                              name="position"
                              defaultValue={i + 1}
                              title="gõ số rồi Enter để nhảy tới vị trí đó"
                              style={i === 0 && m.state === "active" ? { color: "var(--ok)" } : undefined}
                            />
                          </form>
                        </td>
                        <td>
                          {/* Off keeps the member and its place; × removes it. */}
                          <form action={actionToggleMember}>
                            <input type="hidden" name="poolId" value={pool.id} />
                            <input type="hidden" name="listingId" value={m.id} />
                            <input type="hidden" name="enabled" value={m.state === "active" ? "0" : "1"} />
                            <button
                              className={`btn icon ${m.state === "active" ? "on" : "offbtn"}`}
                              type="submit"
                              title={m.state === "active" ? "tắt — giữ nguyên vị trí" : "bật lại"}
                            >
                              {m.state === "active" ? "on" : "off"}
                            </button>
                          </form>
                        </td>
                        <td>
                          <Badge tone={m.platform === "vilao" ? "accent" : "neutral"}>{m.platform}</Badge>
                        </td>
                        <td className="faint">{m.seller ?? "—"}</td>
                        <td className="mono">
                          {m.display_name}
                          {m.stale === 1 && <span style={{ color: "var(--warn)" }}> (cũ)</span>}
                        </td>
                        <td className="num mono">{vnd(m.price_in)}</td>
                        <td className="num mono">{vnd(m.price_out)}</td>
                        <td>{successCell(m, stats)}</td>
                        <td className="num mono">{vnd(estimatedCost(m))} ₫</td>
                        <td className="num mono faint" title="giá ước tính chia cho độ tin cậy">
                          {(estimatedCost(m) / reliability(m, stats.get(m.id))).toFixed(1)}
                        </td>
                        <td>{probeCell(probes.get(m.id))}</td>
                        <td className="num">
                          <form action={actionSetWeight}>
                            <input type="hidden" name="poolId" value={pool.id} />
                            <input type="hidden" name="listingId" value={m.id} />
                            <input className="w" name="weight" defaultValue={m.weight} />
                          </form>
                        </td>
                        <td>
                          <span style={{ display: "flex", gap: 4 }}>
                            <Move poolId={pool.id} listingId={m.id} direction={-1} label="↑" />
                            <Move poolId={pool.id} listingId={m.id} direction={1} label="↓" />
                            <form action={actionMemberState}>
                              <input type="hidden" name="poolId" value={pool.id} />
                              <input type="hidden" name="listingId" value={m.id} />
                              <input type="hidden" name="state" value="candidate" />
                              <button className="btn icon danger" type="submit" title="bỏ khỏi pool">×</button>
                            </form>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <details style={{ marginTop: 14 }}>
              <summary>
                Luật tự nhận thành viên {rule ? "· đang bật" : "· tắt"}
                {queue.length > 0 && (
                  <span style={{ color: "var(--warn)" }}> · {queue.length} chờ duyệt</span>
                )}
              </summary>
              <form action={actionSetRule} className="card" style={{ marginTop: 8 }}>
                <input type="hidden" name="poolId" value={pool.id} />
                <textarea
                  name="ruleJson"
                  rows={2}
                  placeholder='{"platform":"ckey","search":"opus","maxPriceIn":500}'
                  defaultValue={rule ? JSON.stringify(rule.filter) : ""}
                  style={{ width: "100%" }}
                />
                <div className="toolbar" style={{ marginTop: 8 }}>
                  <label className="check">
                    <input type="checkbox" name="autoAdmit" value="1" defaultChecked={rule?.autoAdmit} />
                    tự nhận thẳng, bỏ hàng chờ duyệt
                  </label>
                  <button className="btn" type="submit">Lưu luật</button>
                </div>
              </form>
            </details>

            {queue.length > 0 && (
              <>
                <h2 className="section">{queue.length} listing khớp luật, chờ duyệt</h2>
                <div className="tablewrap">
                  {queue.slice(0, 14).map((q) => (
                    <div className="queue-row" key={q.id}>
                      <Badge tone="neutral">{q.platform}</Badge>
                      <span className="who mono">{q.display_name}</span>
                      <span className="faint mono">vào {vnd(q.price_in)}</span>
                      <span style={{ minWidth: 96 }}>{probeCell(probes.get(q.id))}</span>
                      <StateButton poolId={pool.id} listingId={q.id} state="active" label="Nhận" />
                      <StateButton poolId={pool.id} listingId={q.id} state="blocked" label="Chặn" />
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        );
      })}
    </Shell>
  );
}

/** Published rate where a platform gives one; otherwise what we measured. */
function successCell(m: PoolMember, stats: ReturnType<typeof measuredStats>) {
  if (m.success_rate !== null) {
    return <Badge tone={m.success_rate >= 95 ? "ok" : "warn"}>{m.success_rate.toFixed(1)}%</Badge>;
  }
  const own = stats.get(m.id);
  if (!own) return <span className="faint">chưa đo</span>;
  const rate = (1 - own.failures / own.calls) * 100;
  return (
    <Badge tone={rate >= 95 ? "accent" : "bad"} title="gateway tự đo">
      ~{rate.toFixed(0)}% · {own.calls}
    </Badge>
  );
}

/** Latest verify outcome for one listing. */
function probeCell(probe: { status: string; latency_ms: number | null; error_code: string | null } | undefined) {
  if (!probe) return <span className="faint">—</span>;
  if (probe.status === "ok") return <Badge tone="ok">{secs(probe.latency_ms)}</Badge>;
  return <Badge tone="bad">{probe.error_code ?? "hỏng"}</Badge>;
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
      <button className={`btn ${state === "active" ? "primary" : ""}`} type="submit">{label}</button>
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
      <button className="btn icon" type="submit">{label}</button>
    </form>
  );
}
