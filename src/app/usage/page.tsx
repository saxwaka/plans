import { actionReconcile } from "../actions";
import { btn, c, Nav, Td, Th, vnd } from "../ui";
import { spendByDay, spendByListing, unpricedTotal } from "@/lib/gateway/runlog";

export const dynamic = "force-dynamic";

export default function Usage() {
  const days = spendByDay(14);
  const listings = spendByListing(30);
  const unpriced = unpricedTotal();

  return (
    <main style={{ maxWidth: 1200, margin: "0 auto" }}>
      <Nav here="/usage" />

      <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.2rem" }}>
        <form action={actionReconcile}>
          <button style={btn} type="submit">đối soát chi phí Vilao</button>
        </form>
        <span style={{ fontSize: "0.72rem", color: unpriced > 0 ? c.warn : c.dim }}>
          {unpriced === 0
            ? "mọi request đã có giá"
            : `${unpriced} request chưa rõ giá — Vilao không trả cost trong response, phải đối soát qua API quản lý`}
        </span>
      </div>

      <h2 style={{ fontSize: "0.85rem", color: c.dim, fontWeight: 400 }}>Theo ngày</h2>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem", marginBottom: "2.5rem" }}>
        <thead>
          <tr style={{ textAlign: "left", color: c.dim }}>
            <Th>Ngày</Th><Th>Request</Th><Th>Hỏng</Th><Th>Chi</Th>
            <Th>Lãng phí</Th><Th>Chưa rõ giá</Th>
          </tr>
        </thead>
        <tbody>
          {days.length === 0 && (
            <tr><td colSpan={6} style={{ padding: "1rem 0", color: c.dim }}>Chưa có dữ liệu.</td></tr>
          )}
          {days.map((d) => (
            <tr key={d.day} style={{ borderTop: `1px solid ${c.line}` }}>
              <Td>{d.day}</Td>
              <Td>{d.calls}</Td>
              <Td>
                <span style={{ color: d.failures > 0 ? c.bad : undefined }}>{d.failures}</span>
              </Td>
              <Td>{vnd(d.cost)}₫</Td>
              {/* Failed attempts are still billed, so falling back has a price. */}
              <Td>
                <span style={{ color: d.wasted > 0 ? c.warn : c.dim }}>{vnd(d.wasted)}₫</span>
              </Td>
              <Td>
                <span style={{ color: d.unpriced > 0 ? c.warn : c.dim }}>{d.unpriced}</span>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ fontSize: "0.85rem", color: c.dim, fontWeight: 400 }}>Theo listing</h2>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
        <thead>
          <tr style={{ textAlign: "left", color: c.dim }}>
            <Th>Listing</Th><Th>Sàn</Th><Th>Gọi</Th><Th>Hỏng</Th>
            <Th>Tỷ lệ hỏng</Th><Th>Chi</Th><Th>Độ trễ TB</Th>
          </tr>
        </thead>
        <tbody>
          {listings.map((l) => {
            const failRate = l.calls === 0 ? 0 : (l.failures / l.calls) * 100;
            return (
              <tr key={l.listing_id} style={{ borderTop: `1px solid ${c.line}` }}>
                <Td>{l.listing_id.replace(/^(ckey|vilao):/, "")}</Td>
                <Td>{l.platform}</Td>
                <Td>{l.calls}</Td>
                <Td>{l.failures}</Td>
                <Td>
                  <span style={{ color: failRate > 20 ? c.bad : failRate > 0 ? c.warn : c.ok }}>
                    {failRate.toFixed(0)}%
                  </span>
                </Td>
                <Td>
                  {vnd(l.cost)}₫
                  {l.unpriced > 0 && (
                    <span style={{ color: c.warn }} title="còn request chưa đối soát"> +{l.unpriced}?</span>
                  )}
                </Td>
                <Td>{l.avg_latency ? `${(l.avg_latency / 1000).toFixed(1)}s` : "—"}</Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
