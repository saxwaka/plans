# LLM Gateway

Gateway OpenAI-compatible chạy local, đứng trước [Vilao](https://vilao.ai) và [CKey](https://ckey.vn).
Công cụ của bạn trỏ vào gateway; key thật của hai sàn không bao giờ rời server.

Kế hoạch: `plans/web-gom-api-vilao-ckey.md` · Khảo sát API: `docs/api-notes.md` · Mốc hiện tại: `plans/m1-duong-ong.md`

## Trạng thái — M1 xong

Có: `/v1/chat/completions` (stream + sync), `/v1/models`, key riêng, log tiền từng request, dashboard.
**Chưa có:** pool, filter, định tuyến, fallback, Vilao. Một upstream CKey gọi cứng.

M1 **chưa có fallback** — listing hỏng là request hỏng. Vì thế `GATEWAY_DEFAULT_MODEL`
nên là listing đã kiểm chứng, đừng chọn rẻ nhất chưa rõ.

## Chạy

```bash
npm install
cp .env.example .env.local     # điền CKEY_API_KEY
npm run db:init
npm run key:create cursor      # key chỉ hiện MỘT LẦN
npm run build && npm run start
```

Trỏ công cụ vào:

| | |
|---|---|
| Base URL | `http://localhost:3000/v1` |
| API key | key `gw-...` vừa tạo |

Dashboard ở `http://localhost:3000`.

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
src/lib/gateway/  auth · config · errors · stream · modelname · runlog · upstream/ckey
src/lib/db/       schema + kết nối
```
