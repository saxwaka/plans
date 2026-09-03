# LLM Gateway

Gateway OpenAI-compatible chạy local, đứng trước [Vilao](https://vilao.ai) và [CKey](https://ckey.vn).
Công cụ của bạn trỏ vào gateway; key thật của hai sàn không bao giờ rời server.

Kế hoạch: `plans/web-gom-api-vilao-ckey.md` · Khảo sát API: `docs/api-notes.md` · Mốc hiện tại: `plans/m1-duong-ong.md`

## Trạng thái — M1 → M4 xong

| | |
|---|---|
| `/v1/chat/completions` | stream + sync, giải tên pool, log tiền từng request |
| `/v1/messages` | giao thức Anthropic, cho Claude Code — **chỉ chạy listing CKey** |
| `/v1/models` | pool đứng trước, rồi tới listing thô |
| `/catalog` | 1.096 listing từ hai sàn, lọc đầy đủ |
| `/pools` | tạo pool, thêm/bớt/đổi thứ tự thành viên |

M4 thêm: fallback tự động, bốn chiến lược (failover · round-robin · weighted · pinned),
giữ chunk đầu, phân loại lỗi đáng thử lại, trần chi tiêu theo pool, đo tiền lãng phí.

**Chưa có (M5 trở đi):** đối soát chi phí Vilao, trang Usage, pool theo luật, học chất lượng.

### Fallback hoạt động thế nào

Hỏng ở thành viên #1 thì tự tụt xuống #2 — nhưng chỉ khi thoả **cả hai** điều kiện:

1. Lỗi **đáng thử lại**. 402, 403, 404, 429, 5xx thì có. 400 do prompt sai thì
   **không** — sàn nào cũng hỏng như nhau, thử lại chỉ tốn tiền. 401 cũng không:
   đó là key upstream của bạn sai, cần bạn biết chứ không nên bị che đi.
2. **Trước** khi byte đầu tiên rời server. Đã stream ra rồi thì không rút lại được.

Lưu ý 404 được thử lại, ngược với thói quen thông thường: ở marketplace nó nghĩa là
*người bán này* không còn bán model đó, người bán khác vẫn có thể có.

Response kèm `X-Gateway-Attempts`, `X-Gateway-Listing`, `X-Gateway-Pool` để biết
request vừa rồi thực sự chạy qua đâu.

### Giới hạn đang có, cố ý và hiện rõ trên UI

- **Trần chi tiêu mù với Vilao.** Vilao không trả cost trong response
  (`usage.cost` luôn 0), nên trần ngân sách chỉ chặn được chi tiêu CKey.
  Pool nào có request Vilao chưa tính giá sẽ hiện cảnh báo đỏ ngay cạnh ô trần.
  Dashboard ghi "Chi hôm nay (thiếu)" thay vì đưa ra tổng sai. M5 đối soát.
- **`/v1/messages` bỏ qua thành viên Vilao.** Vilao chỉ nói OpenAI. Thay vì viết
  bộ dịch hai chiều (phải sửa cả frame giữa stream), endpoint này chọn thành viên
  CKey trong pool; pool toàn Vilao thì báo lỗi kèm lý do.
- **Chưa đo chất lượng CKey.** Điểm xếp hạng dùng `success_rate` Vilao công bố;
  listing CKey nằm ở mức "chưa kiểm chứng" 0.5 cho tới M6.

## Chạy

```bash
npm install
cp .env.example .env.local     # điền CKEY_API_KEY
npm run db:init
npm run key:create cursor      # key chỉ hiện MỘT LẦN
npm run sync                   # kéo catalog hai sàn về
npm run build && npm run start
```

Trỏ công cụ vào:

| | |
|---|---|
| Base URL | `http://localhost:3000/v1` |
| API key | key `gw-...` vừa tạo |

Dashboard ở `http://localhost:3000`. Tạo pool ở `/pools`, thêm thành viên từ `/catalog`.

Bỏ trống `VILAO_API_KEY` và `VILAO_PAT` thì gateway chạy thuần CKey, không lỗi.

### Trỏ Claude Code vào

```bash
export ANTHROPIC_BASE_URL=http://localhost:3000   # root, KHÔNG có /v1
export ANTHROPIC_API_KEY=gw-...
```

## Vận hành

Gateway là **điểm chịu lỗi tập trung** — nó chết thì mọi công cụ chết.

- **Đừng dùng `npm run dev` làm gateway thật.** Build rồi chạy dưới pm2 hoặc systemd
- SQLite chạy WAL; log chỉ ghi **sau khi** stream kết thúc, để không chặn event loop
- Nếu chạy trong container có egress proxy, Node fetch cần `NODE_USE_ENV_PROXY=1`
  (curl đọc `HTTPS_PROXY`, Node thì không)

## Bố cục

`src/lib/gateway/` **không import gì từ `next`** — để sau này bê nguyên sang server Node
trần nếu muốn tách gateway khỏi UI. Đừng để logic định tuyến rò vào route handler.

```
src/app/v1/…      route handler (nơi duy nhất chạm Next.js)
src/app/page.tsx  dashboard
src/lib/gateway/  auth · config · errors · stream · modelname · runlog
                  catalog · filter · pool · resolve · dispatch
                  upstream/ckey · upstream/vilao
src/lib/db/       schema + kết nối
```
