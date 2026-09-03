import { actionLogin } from "./actions";
import { uiPassword } from "@/lib/gateway/session";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function Login({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const configured = Boolean(uiPassword());

  return (
    <div className="shell" style={{ display: "grid", placeItems: "center", minHeight: "100vh" }}>
      <form action={actionLogin} className="card" style={{ width: 360, display: "grid", gap: 12 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, letterSpacing: "-0.02em" }}>LLM Gateway</div>
          <div className="note">Đăng nhập bảng điều khiển</div>
        </div>
        {!configured && (
          <div className="badge warn" style={{ justifyContent: "center", padding: 8, whiteSpace: "normal" }}>
            GATEWAY_UI_PASSWORD chưa đặt — bảng điều khiển đang mở cho mọi người. Đặt biến này trước khi đưa ra mạng.
          </div>
        )}
        {one(sp.error) && <div className="badge bad" style={{ justifyContent: "center" }}>Sai mật khẩu</div>}
        <input type="hidden" name="next" value={one(sp.next) ?? "/"} />
        <input type="password" name="password" placeholder="mật khẩu" autoFocus required disabled={!configured} />
        <button className="btn primary" type="submit" disabled={!configured}>Đăng nhập</button>
        <div className="note" style={{ fontSize: 11.5 }}>
          Chỉ bảng điều khiển cần mật khẩu. <code>/v1</code> và <code>/api</code> dùng key riêng; <code>/docs</code> công khai.
        </div>
      </form>
    </div>
  );
}
