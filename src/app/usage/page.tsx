import { actionReconcile } from "../actions";
import { Badge, Shell, secs, vnd } from "../ui";
import { spendByDay, spendByListing, unpricedTotal } from "@/lib/gateway/runlog";

export const dynamic = "force-dynamic";

export default function Usage() {
  const days = spendByDay(14);
  const listings = spendByListing(30);
  const unpriced = unpricedTotal();

  return (
    <Shell here="/usage">
      <div className="card toolbar" style={{ marginBottom: 20 }}>
        <form action={actionReconcile}>
          <button className="btn primary" type="submit">Đối soát chi phí Vilao</button>
        </form>
        {unpriced === 0 ? (
          <Badge tone="ok">mọi request đã có giá</Badge>
        ) : (
          <>
            <Badge tone="warn">{unpriced} request chưa rõ giá</Badge>
            <span className="note">
              Vilao không trả chi phí trong response — số thật nằm ở API quản lý.
            </span>
          </>
        )}
      </div>

      <h2 className="section">Theo ngày</h2>
      <div className="tablewrap scroll" style={{ marginBottom: 8 }}>
        <table>
          <thead>
            <tr>
              <th>Ngày</th>
              <th className="num">Request</th>
              <th className="num">Hỏng</th>
              <th className="num">Chi</th>
              <th className="num">Lãng phí</th>
              <th className="num">Chưa rõ giá</th>
            </tr>
          </thead>
          <tbody>
            {days.length === 0 && (
              <tr><td className="empty" colSpan={6}>Chưa có dữ liệu.</td></tr>
            )}
            {days.map((d) => (
              <tr key={d.day}>
                <td className="mono">{d.day}</td>
                <td className="num mono">{d.calls}</td>
                <td className="num mono" style={{ color: d.failures > 0 ? "var(--bad)" : undefined }}>
                  {d.failures}
                </td>
                <td className="num mono">{vnd(d.cost)} ₫</td>
                {/* Failed attempts are still billed, so falling back has a price. */}
                <td className="num mono" style={{ color: d.wasted > 0 ? "var(--warn)" : "var(--faint)" }}>
                  {vnd(d.wasted)} ₫
                </td>
                <td className="num mono" style={{ color: d.unpriced > 0 ? "var(--warn)" : "var(--faint)" }}>
                  {d.unpriced}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="section">Theo listing</h2>
      <div className="tablewrap scroll">
        <table>
          <thead>
            <tr>
              <th>Listing</th>
              <th>Sàn</th>
              <th className="num">Gọi</th>
              <th className="num">Hỏng</th>
              <th>Tỷ lệ hỏng</th>
              <th className="num">Chi</th>
              <th className="num">Độ trễ TB</th>
            </tr>
          </thead>
          <tbody>
            {listings.length === 0 && (
              <tr><td className="empty" colSpan={7}>Chưa có dữ liệu.</td></tr>
            )}
            {listings.map((l) => {
              const failRate = l.calls === 0 ? 0 : (l.failures / l.calls) * 100;
              return (
                <tr key={l.listing_id}>
                  <td className="mono">{l.listing_id.replace(/^(ckey|vilao):/, "")}</td>
                  <td>
                    <Badge tone={l.platform === "vilao" ? "accent" : "neutral"}>{l.platform}</Badge>
                  </td>
                  <td className="num mono">{l.calls}</td>
                  <td className="num mono">{l.failures}</td>
                  <td>
                    <Badge tone={failRate > 20 ? "bad" : failRate > 0 ? "warn" : "ok"}>
                      {failRate.toFixed(0)}%
                    </Badge>
                  </td>
                  <td className="num mono">
                    {vnd(l.cost)} ₫
                    {l.unpriced > 0 && (
                      <span style={{ color: "var(--warn)" }} title="còn request chưa đối soát">
                        {" "}+{l.unpriced}?
                      </span>
                    )}
                  </td>
                  <td className="num mono faint">{secs(l.avg_latency)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
