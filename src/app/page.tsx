import { isModelMismatch } from "@/lib/gateway/modelname";
import { Nav } from "./ui";
import { recentRuns, spendToday } from "@/lib/gateway/runlog";

export const dynamic = "force-dynamic";

const vnd = (n: number | null) =>
  n === null ? "—" : n.toLocaleString("vi-VN", { maximumFractionDigits: 1 });

export default function Dashboard() {
  const today = spendToday();
  const runs = recentRuns(50);

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto" }}>
      <Nav here="/" />

      <section style={{ display: "flex", gap: "2.5rem", marginBottom: "2rem" }}>
        <Stat
          label={today.unpriced > 0 ? "Chi hôm nay (thiếu)" : "Chi hôm nay"}
          value={`${vnd(today.total)} ₫`}
        />
        <Stat label="Request" value={String(today.calls)} />
        <Stat
          label="Hỏng"
          value={String(today.failures)}
          tone={today.failures > 0 ? "#ff6b6b" : undefined}
        />
        {/* Never let the total look complete when it is not: Vilao does not
            report cost inline, so those calls are counted but not priced. */}
        {today.unpriced > 0 && (
          <Stat label="Chưa rõ giá" value={String(today.unpriced)} tone="#f0a202" />
        )}
        {/* Falling back is not free: a failed attempt can still be billed, since
            CKey charges its per-call minimum whether or not anything came back. */}
        {today.wasted > 0 && (
          <Stat label="Lãng phí do fallback" value={`${vnd(today.wasted)} ₫`} tone="#f0a202" />
        )}
      </section>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
        <thead>
          <tr style={{ textAlign: "left", color: "#8b93a1" }}>
            <Th>Lúc</Th><Th>Model</Th><Th>Kiểu</Th><Th>In</Th><Th>Out</Th>
            <Th>Tiền</Th><Th>TTFB</Th><Th>Tổng</Th><Th>Kết quả</Th>
          </tr>
        </thead>
        <tbody>
          {runs.length === 0 && (
            <tr>
              <td colSpan={9} style={{ padding: "1.5rem 0", color: "#8b93a1" }}>
                Chưa có request nào.
              </td>
            </tr>
          )}
          {runs.map((r) => (
            <tr key={r.id} style={{ borderTop: "1px solid #23262e" }}>
              <Td>{new Date(r.created_at).toLocaleTimeString("vi-VN")}</Td>
              <Td>
                {r.requested_model}
                {/* A seller quietly serving a different model is the one thing
                    success rates cannot show, so surface a real mismatch — but
                    compare base names, since upstreams drop the seller prefix. */}
                {isModelMismatch(r.requested_model, r.actual_model) && (
                  <span style={{ color: "#f0a202" }}> → {r.actual_model}</span>
                )}
              </Td>
              <Td>
                {r.stream ? "stream" : "sync"}
                {r.attempt_no > 1 && (
                  <span style={{ color: "#f0a202" }} title="lần thử fallback">
                    {" "}#{r.attempt_no}
                  </span>
                )}
              </Td>
              <Td>{r.tokens_in ?? "—"}</Td>
              <Td>{r.tokens_out ?? "—"}</Td>
              <Td>{vnd(r.cost_vnd)}</Td>
              <Td>{r.ttfb_ms ? `${r.ttfb_ms}ms` : "—"}</Td>
              <Td>{r.latency_ms ? `${(r.latency_ms / 1000).toFixed(1)}s` : "—"}</Td>
              <Td>
                <span style={{ color: r.status === "ok" ? "#4ade80" : "#ff6b6b" }}>
                  {r.status === "ok" ? "ok" : (r.error_code ?? r.status)}
                </span>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div style={{ color: "#8b93a1", fontSize: "0.7rem" }}>{label}</div>
      <div style={{ fontSize: "1.6rem", color: tone }}>{value}</div>
    </div>
  );
}

const Th = ({ children }: { children: React.ReactNode }) => (
  <th style={{ padding: "0.4rem 0.6rem 0.4rem 0", fontWeight: 400 }}>{children}</th>
);
const Td = ({ children }: { children: React.ReactNode }) => (
  <td style={{ padding: "0.4rem 0.6rem 0.4rem 0" }}>{children}</td>
);
