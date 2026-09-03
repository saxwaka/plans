import {
  actionCreatePool,
  actionDeletePool,
  actionMoveMember,
  actionRemoveMember,
  syncCatalog,
} from "../actions";
import { btn, c, input, Nav, Td, Th, vnd } from "../ui";
import { listPools, poolMembers } from "@/lib/gateway/pool";
import { countAll } from "@/lib/gateway/filter";

export const dynamic = "force-dynamic";

export default function Pools() {
  const pools = listPools();
  const catalogSize = countAll();

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
        M3 mới chỉ gọi thành viên <strong>#1</strong>; fallback tự động sang #2 là việc của M4.
      </p>

      {pools.length === 0 && (
        <p style={{ color: c.dim, fontSize: "0.8rem" }}>
          Chưa có pool nào. Tạo một cái, rồi sang <a href="/catalog" style={{ color: c.accent }}>catalog</a> thêm thành viên.
        </p>
      )}

      {pools.map((pool) => {
        const members = poolMembers(pool.id);
        return (
          <section key={pool.id} style={{ marginBottom: "2.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.8rem", marginBottom: "0.6rem" }}>
              <h2 style={{ fontSize: "0.95rem", margin: 0 }}>{pool.name}</h2>
              <span style={{ color: c.dim, fontSize: "0.72rem" }}>
                {pool.strategy} · {members.length} thành viên
              </span>
              <form action={actionDeletePool}>
                <input type="hidden" name="poolId" value={pool.id} />
                <button style={{ ...btn, color: c.bad }} type="submit">xoá pool</button>
              </form>
            </div>

            {members.length === 0 ? (
              <p style={{ color: c.warn, fontSize: "0.75rem" }}>
                Pool rỗng — gọi tên này sẽ trả 409. Thêm thành viên từ catalog.
              </p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.76rem" }}>
                <thead>
                  <tr style={{ textAlign: "left", color: c.dim }}>
                    <Th>#</Th><Th>Sàn</Th><Th>Người bán</Th><Th>Model</Th>
                    <Th>In</Th><Th>Out</Th><Th>/req</Th><Th>Success</Th><Th>Request</Th><Th />
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
                        {m.success_rate === null ? (
                          <span style={{ color: c.dim }}>chưa đo</span>
                        ) : (
                          `${m.success_rate.toFixed(1)}%`
                        )}
                      </Td>
                      <Td>{m.total_requests?.toLocaleString("vi-VN") ?? "—"}</Td>
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
