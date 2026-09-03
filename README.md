# LLM Gateway

Gateway OpenAI-compatible chạy local, đứng trước [Vilao](https://vilao.ai) và [CKey](https://ckey.vn).
Công cụ của bạn trỏ vào gateway; key thật của hai sàn không bao giờ rời server.

Kế hoạch: `plans/web-gom-api-vilao-ckey.md` · Khảo sát API: `docs/api-notes.md` · Mốc hiện tại: `plans/m1-duong-ong.md`

## Trạng thái — M1, M2, M3 xong

| | |
|---|---|
| `/v1/chat/completions` | stream + sync, giải tên pool, log tiền từng request |
| `/v1/messages` | giao thức Anthropic, cho Claude Code — **chỉ chạy listing CKey** |
| `/v1/models` | pool đứng trước, rồi tới listing thô |
| `/catalog` | 1.096 listing từ hai sàn, lọc đầy đủ |
| `/pools` | tạo pool, thêm/bớt/đổi thứ tự thành viên |

**Chưa có (M4 trở đi):** fallback tự động, chiến lược round-robin/trọng số,
giữ chunk đầu, trần chi tiêu, pool theo luật, học chất lượng.

Hai giới hạn đang có, cố ý và đã hiện rõ trên UI:

- **Pool mới chỉ gọi thành viên #1.** Thành viên đó hỏng là request hỏng — fallback là M4
- **Chi tiêu Vilao chưa tính được.** Vilao không trả cost trong response
  (`usage.cost` luôn 0); số thật nằm ở API quản lý. Dashboard vì thế ghi
  "Chi hôm nay (thiếu)" kèm số request chưa rõ giá, thay vì đưa ra tổng sai. M5 đối soát.

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
