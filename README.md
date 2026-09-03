# LLM Gateway

Gateway OpenAI-compatible chạy local, đứng trước [Vilao](https://vilao.ai) và [CKey](https://ckey.vn).
Công cụ của bạn trỏ vào gateway; key thật của hai sàn không bao giờ rời server.

Kế hoạch: `plans/web-gom-api-vilao-ckey.md` · Khảo sát API: `docs/api-notes.md` · Mốc hiện tại: `plans/m1-duong-ong.md`

## Trạng thái — M1 → M6 xong

| | |
|---|---|
| `/v1/chat/completions` | stream + sync, giải tên pool, log tiền từng request |
| `/v1/messages` | giao thức Anthropic, cho Claude Code — **chỉ chạy listing CKey** |
| `/v1/models` | pool đứng trước, rồi tới listing thô |
| `/catalog` | 1.096 listing từ hai sàn, lọc đầy đủ |
| `/pools` | tạo pool, thành viên, chiến lược, trần chi tiêu, luật tự nhận |
| `/usage` | chi tiêu theo ngày và theo listing, nút đối soát Vilao |

M4 thêm fallback tự động, năm chiến lược, giữ chunk đầu, phân loại lỗi, trần chi tiêu.
M5 thêm đối soát chi phí Vilao và trang Usage. M6 thêm pool theo luật và học chất lượng.

### Chiến lược pool

| | |
|---|---|
| `failover` | theo đúng thứ tự bạn kéo thả |
| `cheapest` | theo **điểm** = giá ước tính ÷ độ tin cậy — rẻ mà hay hỏng vẫn xếp sau |
| `round-robin` | chia đều lượt, tránh chạm rate limit một người bán |
| `weighted` | chia theo trọng số bạn đặt |
| `pinned` | luôn thành viên #1 |

### Độ tin cậy được tính thế nào

Trộn **số Vilao công bố** với **số gateway tự đo**, làm mượt Bayes về 0.8:

```
tin cậy = (thành công công bố + thành công tự đo + 0.8×20) / (tổng lượt + 20)
```

Vilao có listing dựa trên 849k request nên số của họ áp đảo — đúng như vậy.
CKey không công bố gì nên chạy hoàn toàn bằng số tự đo, cần khoảng 20 lượt gọi
mới thoát ảnh hưởng của prior. Listing **chưa ai đo** bị phạt xuống 0.5 —
"không biết" không phải "trung bình", và nó không bao giờ được đứng đầu chỉ nhờ rẻ.

### Thăm dò có kiểm soát

Muốn biết một listing CKey rẻ có dùng được không thì phải gửi request thật vào —
mà nó có thể hỏng đúng request bạn cần. Nên listing chưa kiểm chứng **chỉ được
đứng đầu khi request không streaming**, tức là lúc fallback còn cứu được và bạn
không thấy gì. Khi streaming, chúng bị đẩy xuống sau các listing đã biết.
Gateway **không bao giờ tự bắn thử** để học — chỉ học từ request bạn thật sự cần.

### Kiểm tra pool

Nút **kiểm tra pool** gọi thật một request `max_tokens=1` tới **mọi** thành viên
và mọi listing đang chờ duyệt, 4 cái song song, rồi ghi kết quả: sống/chết, độ
trễ, chi phí. Kết quả hiện ngay cạnh từng listing — kể cả trong hàng chờ duyệt,
nên bạn duyệt dựa trên bằng chứng chứ không phải đoán.

**Nó tốn tiền thật, và không rẻ như tên gọi gợi ý.** Đo trên pool 18 listing:
phần token chỉ 0.0002₫, nhưng thực trả 5–72₫ mỗi listing vì giá tính
`max(sàn, per_request + token)` — request bé thì **sàn quyết định tất**. Vì vậy
nút luôn báo giá trước khi bấm. Con số đó là **cận trên**: listing hỏng không bị
tính tiền, nên lần đo thật 18 listing báo 338₫ mà chỉ trả 207₫.

Kết quả một lần chạy thật, cho thấy vì sao tính năng này đáng có:

```
13/18 sống · độ trễ từ 2.7s đến 17.3s
rẻ nhất & nhanh: phongnguyenpha/gpt-5.6-luna   2₫   5.0s
đắt nhất & chậm nhất: thanhnhan9023/...-cheap  72₫  17.3s   ← tên là "cheap"
chết: 2 api_error, 3 timeout (45s)
```

Probe được ghi vào log như request thường nhưng gắn `kind='probe'` — vẫn tính
vào độ tin cậy vì đó là bằng chứng thật, nhưng tách được khỏi chi tiêu thật.
Gateway **không bao giờ tự chạy** việc này theo lịch; chỉ chạy khi bạn bấm.

### Pool theo luật

Lưu một bộ filter vào pool; sau mỗi lần sync, listing mới khớp luật sẽ vào
**hàng chờ duyệt**, không tự vào vòng chạy. Có công tắc "tự nhận thẳng" nếu bạn
chấp nhận rủi ro — nhưng kể cả bật, listing chưa kiểm chứng vẫn bị điểm số giữ
lại khỏi vị trí #1.

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

- **Chi phí Vilao về trễ vài giây.** Vilao không trả cost trong response
  (`usage.cost` luôn 0), nên gateway đối soát ngầm với API quản lý khoảng 5 giây
  sau mỗi lần gọi. Hai bên không chung id nên ghép theo người bán + model + số
  token + thời gian; mỗi bản ghi usage chỉ dùng một lần. Trong khoảng trễ đó,
  trần ngân sách chưa thấy khoản chi này — pool nào còn request chưa tính giá sẽ
  hiện cảnh báo đỏ cạnh ô trần. Ép đối soát ngay bằng `npm run reconcile` hoặc
  nút ở trang `/usage`.
- **`/v1/messages` bỏ qua thành viên Vilao.** Vilao chỉ nói OpenAI. Thay vì viết
  bộ dịch hai chiều (phải sửa cả frame giữa stream), endpoint này chọn thành viên
  CKey trong pool; pool toàn Vilao thì báo lỗi kèm lý do.
- **Chất lượng đầu ra không đo được.** `success_rate` chỉ nói request có trả về
  hay không, **không** nói trả về có tốt không. Người bán rẻ hoàn toàn có thể
  lặng lẽ phục vụ model yếu hơn mà vẫn đạt 99%. Gateway không tự phát hiện được:
  nó chỉ cảnh báo khi `actual_model` lệch tên. Việc quan trọng nên dùng pool
  `pinned` vào người bán bạn tin.

## Chạy

```bash
npm install
cp .env.example .env.local     # điền CKEY_API_KEY
npm run db:init
npm run key:create cursor      # key chỉ hiện MỘT LẦN
npm run sync                   # kéo catalog hai sàn về (và áp dụng luật pool)
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
                  catalog · filter · pool · resolve · dispatch · execute
                  routing · budget · stats · rules · reconcile
                  upstream/ckey · upstream/vilao
src/lib/db/       schema + kết nối
```
