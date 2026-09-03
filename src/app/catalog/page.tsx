import { actionAddMember, syncCatalog } from "../actions";
import { Badge, Shell, vnd } from "../ui";
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
    maxPriceIn: num(sp.maxPriceIn),
    minContext: num(sp.minContext),
    minSuccessRate: num(sp.minSuccessRate),
    minTotalRequests: num(sp.minTotalRequests),
    supportsTools: one(sp.supportsTools) === "1",
    verifiedOnly: one(sp.verifiedOnly) === "1",
    // The trap in this catalog: quality fields are sparse. Dropping unmeasured
    // listings erases every CKey row, since CKey publishes no stats at all.
    includeUnmeasured: one(sp.includeUnmeasured) !== "0",
  };

  const total = countAll();
  const matching = countListings(filter);
  const rows = queryListings(filter, 300);
  const pools = listPools();

  return (
    <Shell here="/catalog">
      <form method="get" className="card toolbar" style={{ marginBottom: 16 }}>
        <input name="search" placeholder="tên model" defaultValue={one(sp.search) ?? ""} style={{ width: 190 }} />
        <select name="platform" defaultValue={one(sp.platform) ?? ""}>
          <option value="">mọi sàn</option>
          <option value="ckey">ckey</option>
          <option value="vilao">vilao</option>
        </select>
        <Field label="giá vào ≤" name="maxPriceIn" value={one(sp.maxPriceIn)} />
        <Field label="thành công ≥" name="minSuccessRate" value={one(sp.minSuccessRate)} suffix="%" />
        <Field label="số request ≥" name="minTotalRequests" value={one(sp.minTotalRequests)} />
        <Field label="context ≥" name="minContext" value={one(sp.minContext)} />
        <label className="check">
          <input type="checkbox" name="supportsTools" value="1" defaultChecked={one(sp.supportsTools) === "1"} />
          tools
        </label>
        <label className="check">
          <input type="checkbox" name="verifiedOnly" value="1" defaultChecked={one(sp.verifiedOnly) === "1"} />
          đã xác minh
        </label>
        <label className="check" title="Bỏ dấu này sẽ loại sạch CKey — sàn đó không công bố số liệu nào">
          <input
            type="checkbox"
            name="includeUnmeasured"
            value="1"
            defaultChecked={one(sp.includeUnmeasured) !== "0"}
          />
          gồm cả chưa có dữ liệu
        </label>
        <input type="hidden" name="includeUnmeasured" value="0" />
        <button className="btn primary" type="submit">Lọc</button>
        <a className="btn" href="/catalog">Bỏ lọc</a>
      </form>

      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "0 0 12px" }}>
        {/* Always show the survivor count: a filter that quietly removes 90% of
            the catalog is the difference between a useful pool and an empty one. */}
        <Badge tone={matching === 0 ? "bad" : "accent"}>
          {matching.toLocaleString("vi-VN")} / {total.toLocaleString("vi-VN")} listing
        </Badge>
        {matching === 0 && (
          <span className="note">Nới điều kiện, hoặc bật lại “gồm cả chưa có dữ liệu”.</span>
        )}
        {total === 0 && (
          <form action={syncCatalog}>
            <button className="btn primary" type="submit">Đồng bộ danh mục</button>
          </form>
        )}
      </div>

      <div className="tablewrap scroll">
        <table>
          <thead>
            <tr>
              <th>Sàn</th>
              <th>Người bán</th>
              <th>Model</th>
              <th className="num">Vào</th>
              <th className="num">Ra</th>
              <th className="num">Mỗi lượt</th>
              <th className="num">Tối thiểu</th>
              <th className="num">Context</th>
              <th>Thành công</th>
              <th className="num">Lượt gọi</th>
              <th>Thêm vào pool</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id} className={l.stale ? "off" : undefined}>
                <td>
                  <Badge tone={l.platform === "vilao" ? "accent" : "neutral"}>{l.platform}</Badge>
                </td>
                <td className="faint">{l.seller ?? "—"}</td>
                <td className="mono">
                  {l.display_name}
                  {l.stale === 1 && <span className="faint"> (cũ)</span>}
                </td>
                <td className="num mono">{vnd(l.price_in)}</td>
                <td className="num mono">{vnd(l.price_out)}</td>
                <td className="num mono">{vnd(l.price_request)}</td>
                <td className="num mono">{vnd(l.price_floor)}</td>
                <td className="num mono faint">
                  {l.context_len ? `${Math.round(l.context_len / 1000)}k` : "—"}
                </td>
                <td>
                  {l.success_rate === null ? (
                    <span className="faint">chưa đo</span>
                  ) : (
                    <Badge tone={l.success_rate >= 95 ? "ok" : "warn"}>
                      {l.success_rate.toFixed(1)}%
                    </Badge>
                  )}
                </td>
                <td className="num mono faint">{l.total_requests?.toLocaleString("vi-VN") ?? "—"}</td>
                <td>
                  {pools.length === 0 ? (
                    <span className="faint">chưa có pool</span>
                  ) : (
                    <form action={actionAddMember} style={{ display: "flex", gap: 5 }}>
                      <input type="hidden" name="listingId" value={l.id} />
                      <select name="poolId" style={{ maxWidth: 130 }}>
                        {pools.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                      <button className="btn" type="submit">+</button>
                    </form>
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

/** A labelled number box — the placeholder alone vanishes once a value is set,
 *  which left the filter row as a line of unlabelled numbers. */
function Field({
  label,
  name,
  value,
  suffix,
}: {
  label: string;
  name: string;
  value?: string;
  suffix?: string;
}) {
  return (
    <label className="check" style={{ gap: 5 }}>
      <span className="faint">{label}</span>
      <input name={name} defaultValue={value ?? ""} style={{ width: 66 }} />
      {suffix && <span className="faint">{suffix}</span>}
    </label>
  );
}
