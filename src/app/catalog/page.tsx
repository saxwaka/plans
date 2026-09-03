import { actionAddMember, syncCatalog } from "../actions";
import { btn, c, input, Nav, Td, Th, vnd } from "../ui";
import { countAll, countListings, queryListings, type ListingFilter } from "@/lib/gateway/filter";
import { listPools } from "@/lib/gateway/pool";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const num = (v: string | string[] | undefined) => {
  const s = one(v);
  return s === undefined || s === "" ? undefined : Number(s);
};

export default async function Catalog({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;

  const filter: ListingFilter = {
    platform: one(sp.platform) as ListingFilter["platform"],
    search: one(sp.search) || undefined,
    seller: one(sp.seller) || undefined,
    maxPriceIn: num(sp.maxPriceIn),
    minContext: num(sp.minContext),
    minSuccessRate: num(sp.minSuccessRate),
    minTotalRequests: num(sp.minTotalRequests),
    supportsTools: one(sp.supportsTools) === "1",
    verifiedOnly: one(sp.verifiedOnly) === "1",
    // Sparse quality fields are the trap here: excluding unmeasured listings
    // erases every CKey row, since CKey publishes no stats at all.
    includeUnmeasured: one(sp.includeUnmeasured) !== "0",
  };

  const total = countAll();
  const matching = countListings(filter);
  const rows = queryListings(filter, 300);
  const pools = listPools();

  return (
    <main style={{ maxWidth: 1400, margin: "0 auto" }}>
      <Nav here="/catalog" />

      <form method="get" style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
        <input style={{ ...input, width: 190 }} name="search" placeholder="tên model" defaultValue={one(sp.search) ?? ""} />
        <select style={btn} name="platform" defaultValue={one(sp.platform) ?? ""}>
          <option value="">mọi sàn</option>
          <option value="ckey">ckey</option>
          <option value="vilao">vilao</option>
        </select>
        <input style={{ ...input, width: 120 }} name="maxPriceIn" placeholder="giá in ≤" defaultValue={one(sp.maxPriceIn) ?? ""} />
        <input style={{ ...input, width: 130 }} name="minSuccessRate" placeholder="success ≥ %" defaultValue={one(sp.minSuccessRate) ?? ""} />
        <input style={{ ...input, width: 130 }} name="minTotalRequests" placeholder="≥ N request" defaultValue={one(sp.minTotalRequests) ?? ""} />
        <input style={{ ...input, width: 130 }} name="minContext" placeholder="context ≥" defaultValue={one(sp.minContext) ?? ""} />
        <label style={{ fontSize: "0.72rem", color: c.dim }}>
          <input type="checkbox" name="supportsTools" value="1" defaultChecked={one(sp.supportsTools) === "1"} /> tools
        </label>
        <label style={{ fontSize: "0.72rem", color: c.dim }}>
          <input type="checkbox" name="verifiedOnly" value="1" defaultChecked={one(sp.verifiedOnly) === "1"} /> verified
        </label>
        <label style={{ fontSize: "0.72rem", color: c.dim }} title="Bỏ dấu này sẽ loại sạch CKey — sàn đó không công bố số liệu nào">
          <input type="checkbox" name="includeUnmeasured" value="1" defaultChecked={one(sp.includeUnmeasured) !== "0"} /> gồm cả chưa có dữ liệu
        </label>
        <input type="hidden" name="includeUnmeasured" value="0" />
        <button style={btn} type="submit">lọc</button>
        <a style={{ ...btn, textDecoration: "none" }} href="/catalog">bỏ lọc</a>
      </form>

      <p style={{ fontSize: "0.78rem", color: c.dim, margin: "1rem 0" }}>
        {/* Always show the survivor count: a filter that quietly removes 90% of the
            catalog is the difference between a useful pool and an empty one. */}
        <strong style={{ color: matching === 0 ? c.bad : c.ok }}>{matching}</strong> / {total} listing khớp
        {matching === 0 && " — nới điều kiện, hoặc bật lại “gồm cả chưa có dữ liệu”"}
        {total === 0 && (
          <>
            {" · "}
            <form action={syncCatalog} style={{ display: "inline" }}>
              <button style={btn} type="submit">sync catalog</button>
            </form>
          </>
        )}
      </p>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.76rem" }}>
        <thead>
          <tr style={{ textAlign: "left", color: c.dim }}>
            <Th>Sàn</Th><Th>Người bán</Th><Th>Model</Th><Th>In</Th><Th>Out</Th><Th>/req</Th>
            <Th>Sàn tối thiểu</Th><Th>Context</Th><Th>Success</Th><Th>Request</Th><Th>Thêm vào pool</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.id} style={{ borderTop: `1px solid ${c.line}`, opacity: l.stale ? 0.45 : 1 }}>
              <Td>{l.platform}</Td>
              <Td>{l.seller ?? "—"}</Td>
              <Td>{l.display_name}{l.stale ? " (stale)" : ""}</Td>
              <Td>{vnd(l.price_in)}</Td>
              <Td>{vnd(l.price_out)}</Td>
              <Td>{vnd(l.price_request)}</Td>
              <Td>{vnd(l.price_floor)}</Td>
              <Td>{l.context_len ? `${Math.round(l.context_len / 1000)}k` : "—"}</Td>
              <Td>
                {l.success_rate === null ? (
                  <span style={{ color: c.dim }}>chưa đo</span>
                ) : (
                  <span style={{ color: l.success_rate >= 95 ? c.ok : c.warn }}>
                    {l.success_rate.toFixed(1)}%
                  </span>
                )}
              </Td>
              <Td>{l.total_requests?.toLocaleString("vi-VN") ?? "—"}</Td>
              <Td>
                {pools.length === 0 ? (
                  <span style={{ color: c.dim }}>chưa có pool</span>
                ) : (
                  <form action={actionAddMember} style={{ display: "flex", gap: 4 }}>
                    <input type="hidden" name="listingId" value={l.id} />
                    <select style={{ ...btn, maxWidth: 130 }} name="poolId">
                      {pools.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    <button style={btn} type="submit">+</button>
                  </form>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
