# Kế hoạch: Gateway API cá nhân trước Vilao & CKey

Ngày: 2026-09-03 · Trạng thái: v4 — viết lại theo mô hình proxy · Khảo sát: `docs/api-notes.md`

## 1. Sản phẩm

Một **gateway OpenAI-compatible chạy local**. Mọi công cụ (Claude Code, Cursor, Cline, script Python) trỏ base URL vào web của bạn thay vì trỏ thẳng vào Vilao hay CKey.

```
Cursor ─┐
Claude ─┼─→  gateway của bạn  ─→ chọn listing tốt nhất ─┬─→ Vilao   (x-api-key)
script ─┘    localhost:3000/v1                          └─→ CKey    (Bearer)
                    │                                        │
              key riêng của bạn                        lỗi → tụt sang listing kế
                    │
              ghi log tiền + độ trễ + thành/bại
```

Bạn cấp key của **chính bạn** cho từng công cụ. Key thật của Vilao/CKey không bao giờ rời khỏi server.

### Vì sao đáng làm

Đây không phải chỉ để gộp cho gọn. Ba con số từ khảo sát nói rõ giá trị:

- Cùng `claude-opus-4-8`, người bán rẻ nhất **rẻ hơn 25 lần** người bán chính chủ mà tỷ lệ thành công gần bằng (99.0% so với 99.2%, đo trên 11.967 request)
- Trung vị chênh giá **14.6x** trên Vilao, **4.7x** trên CKey
- Cùng người bán `wowz` bán Veo trên cả hai sàn, **CKey đắt hơn đều 20%**

Chọn tay giữa 1.102 listing từ 133 người bán là bất khả thi, và giá đổi ngay giữa phiên làm việc (đã chứng kiến một listing thêm `min_charge` sau vài giờ). Máy chọn thì được.

### Ngoài phạm vi

Không phải chỗ để chat (dùng Open WebUI trỏ vào gateway này). Không đăng nhập, không nhiều người dùng, không deploy public.

## 2. Bốn quyết định kiến trúc khó

Đây là phần đáng bàn nhất, không phải chuyện chọn framework.

### 2a. Streaming giết chết fallback

Khi đã đẩy byte đầu tiên về client, **không thể rút lại để gọi người bán khác**. Mà streaming là bắt buộc — Cursor và Claude Code đều dùng.

Hướng giải quyết: **giữ lại chunk đầu tiên**. Gọi upstream, chờ đến khi nhận được chunk hợp lệ đầu tiên rồi mới bắt đầu ghi ra client. Mọi lỗi trước thời điểm đó (401, 402, 429, 503, timeout, upstream đứt) đều fallback được. Lỗi sau đó thì đành chịu — trả về client kèm cờ đánh dấu, và **tính vào thống kê thất bại của listing đó**.

Chi phí: thêm một chút độ trễ đến token đầu tiên. Đáng, vì phần lớn lỗi của sàn relay xảy ra ngay lúc bắt tay.

### 2b. Vilao bắt subscribe trước khi gọi

Không thể gọi một model Vilao mà key chưa subscribe — trả `FORBIDDEN`. Nhưng bộ định tuyến lại chọn listing **tại thời điểm chạy**.

Hướng giải quyết: **tự subscribe khi cần**. Trước khi gọi một listing Vilao lần đầu, `POST /api/v2/llm/keys/:id/subscriptions`, ghi nhớ vào DB, rồi gọi. Lần sau bỏ qua. Cần PAT sống trong server, và cần xử lý được trường hợp subscribe hỏng (coi như listing không khả dụng, tụt xuống listing kế).

CKey không có bước này — gọi thẳng.

### 2c. Học chất lượng của CKey mà không hại request thật

Vilao công bố sẵn `success_rate` trên 515 listing, có listing dựa trên 849.389 request. **Không cần đo lại, và cũng không thể đo lại được quy mô đó.**

CKey **không công bố gì**. Muốn biết một listing CKey giá rẻ có dùng được không thì phải gửi traffic thật vào — mà nó có thể hỏng đúng request bạn đang cần.

Hướng giải quyết, ba tầng:
1. **Mặc định an toàn.** Listing CKey chưa có dữ liệu bị xếp hạng "chưa kiểm chứng", không bao giờ tự động đứng đầu
2. **Thăm dò có kiểm soát.** Chỉ thử listing lạ khi request **không streaming** và fallback còn nguyên — hỏng thì tụt xuống listing đã tin cậy, người dùng không thấy gì
3. **Không tự bắn thử.** Không gọi thăm dò định kỳ để đốt tiền. Chỉ học từ request bạn thật sự cần

Đây là điểm khác biệt cốt lõi so với mọi relay có sẵn.

### 2d. Tên model không khớp nhau

Cùng một model mang ba dạng tên: `claude-opus-4-8` (Vilao), `claude-opus-4.8` (CKey), `dungcsnd113/claude-opus-5` (CKey có tiền tố người bán), và có cả `GPT-5.6-sol` lẫn `gpt-5.6-sol`.

Gateway phải phơi ra **một tên chuẩn duy nhất** cho client. Bảng ánh xạ `canonical → [listing]` là trái tim của hệ thống.

Hướng giải quyết: chuẩn hoá tự động (bỏ tiền tố người bán, thường hoá, `.` ↔ `-`) rồi **cho sửa tay**, vì tự động chắc chắn sẽ sai vài chỗ. Giữ `raw_json` để đối chiếu.

## 3. Kiến trúc

**Next.js (App Router) + TypeScript + SQLite.** Một process vừa là gateway vừa là dashboard.

Nguyên tắc quan trọng: **toàn bộ logic gateway nằm trong `lib/gateway/`, không dính framework.** Nếu sau này bạn muốn gateway chạy headless thường trực tách khỏi UI, chỉ việc bê thư mục đó sang một server Node trần. Đừng để logic định tuyến rò vào route handler.

```
app/
  api/v1/chat/completions/route.ts   → endpoint OpenAI-compatible (stream)
  api/v1/messages/route.ts           → endpoint Anthropic (cho Claude Code)
  api/v1/models/route.ts             → catalog chuẩn hoá
  page.tsx                           → dashboard: request gần đây, tiền, sức khoẻ
  models/                            → catalog, so giá, ghim/chặn listing
  usage/                             → chi tiêu theo ngày / model / listing
  settings/                          → key upstream, key phát hành, chính sách route
lib/gateway/            ← KHÔNG dính Next.js
  upstream/
    vilao.ts            → x-api-key; auto-subscribe; đọc cost từ /api/v2/llm/usage
    ckey.ts             → Bearer; đọc cost từ usage.x_ckey.cost
    types.ts
  catalog.ts            → sync + chuẩn hoá tên
  routing.ts            → chấm điểm, chọn, chuỗi fallback
  pricing.ts            → max(sàn, per_request + token/1e6 × giá)
  stream.ts             → giữ chunk đầu, chuyển tiếp SSE
  errors.ts             → chuẩn hoá 3 envelope lỗi về một dạng
lib/db/
```

### Luồng một request

```
1. Xác thực key của bạn                     → 401 nếu sai
2. Tra canonical model → danh sách listing
3. Chấm điểm, sắp thứ tự                    → routing.ts
4. Với từng listing theo thứ tự:
     a. Vilao và chưa subscribe → subscribe
     b. Gọi upstream
     c. Chờ chunk đầu hợp lệ
     d. Lỗi trước chunk đầu → listing kế
5. Chuyển tiếp stream về client
6. Ghi run: tiền, độ trễ, thành/bại, listing nào
```

## 4. Data model

- `client_key(id, name, key_hash, active, created_at)` — key gateway phát hành
- `upstream(id, platform, base_url, api_key, pat, enabled)` — vilao / ckey
- `listing(id, upstream_id, external_id, seller, canonical_model, kind, pricing_json, published_stats_json, raw_json, synced_at, stale)`
- `canonical(name, kind, notes)` + `alias(alias, canonical)` — bảng ánh xạ, sửa tay được
- `subscription(listing_id, upstream_sub_id, subscribed_at)` — chỉ Vilao
- `run(id, client_key_id, canonical, listing_id, attempt_no, tokens_in, tokens_out, cost_vnd, latency_ms, ttfb_ms, status, error_code, stream, created_at)`
- `listing_stat(listing_id, calls, failures, p50_ttfb, last_ok_at, last_error)` — dẫn xuất từ `run`

`attempt_no` cho phép ghi cả những lần fallback hỏng — đó chính là dữ liệu quý nhất để chấm điểm.

**Đừng xoá cứng listing khi sync.** Đã đo: catalog CKey đổi trong vòng một giờ. Đánh dấu `stale` để `run` không mồ côi.

## 5. Chấm điểm listing

Công thức khởi điểm, tinh chỉnh sau khi có dữ liệu thật:

```
điểm = giá_ước_tính / độ_tin_cậy

độ_tin_cậy = Vilao : success_rate đã công bố
             CKey  : tự đo, làm mượt Bayes về 0.8 khi mẫu còn ít
             chưa có dữ liệu : 0.5 (phạt nặng, không bao giờ đứng đầu)
```

Ba quy tắc cứng, học từ dữ liệu thật:

- **Xếp hạng theo listing, không theo người bán.** `rouyea` vừa có listing 99.0% trên 11.967 request, vừa có listing 0% trên 1 request
- **Mẫu nhỏ không phải bằng chứng.** "100% trên 1 request" phải xếp dưới "98% trên 10.000 request"
- **Giá rẻ bất thường là cờ đỏ.** Vài listing để 1 VND, gần như chắc chắn là listing hỏng

Chính sách chọn được ở Settings: *rẻ nhất đã kiểm chứng* (mặc định) · *tin cậy nhất* · *ghim cứng một listing*.

## 6. Các mốc

| Mốc | Nội dung | Xong khi |
|---|---|---|
| **M1** Đường ống | `/v1/chat/completions` một upstream cứng, key riêng, streaming | **Trỏ Cursor vào localhost:3000/v1 và code được thật** |
| **M2** Catalog | Sync cả hai, chuẩn hoá tên, `/v1/models`, trang so giá | `/v1/models` trả tên chuẩn; bấm vào thấy mọi listing kèm giá |
| **M3** Định tuyến | Chấm điểm, chuỗi fallback, giữ chunk đầu, auto-subscribe Vilao | Rút phích listing đầu → request vẫn xong qua listing kế, client không biết |
| **M4** Kế toán | Ghi `run`, đối soát tiền hai bên, trang Usage | Biết hôm nay tiêu bao nhiêu, cho listing nào, tiết kiệm bao nhiêu so với giá chính chủ |
| **M5** Học chất lượng | `listing_stat`, thăm dò có kiểm soát, làm mượt Bayes | Listing CKey rẻ tự leo hạng sau khi chứng minh được; listing hỏng tự rơi |
| **M6** Ảnh & video | `/v1/images/generations`, `/v1/videos/generations`, lưu file | Sinh một clip Veo, file nằm trên máy |

**M1 là mốc có giá trị thật ngay** — chỉ cần nó là bạn đã dùng gateway hàng ngày được, dù chưa thông minh. M3 là chỗ khó nhất. M5 là chỗ khác biệt.

Thêm `/v1/messages` (giao thức Anthropic) ở M1 hoặc M2 nếu bạn muốn trỏ Claude Code vào — CKey hỗ trợ sẵn upstream. Lưu ý `ANTHROPIC_BASE_URL` dùng **root domain, không có `/v1`**.

## 7. Rủi ro

| Rủi ro | Xử lý |
|---|---|
| Gateway chết → mọi công cụ chết | Đây là điểm chịu lỗi tập trung. Giữ M1 thật đơn giản; chế độ "bypass" trỏ thẳng một upstream khi định tuyến lỗi |
| Fallback vòng lặp đốt tiền | Giới hạn cứng số lần thử (3), timeout tổng, và **không bao giờ fallback sau khi đã stream** |
| Chi phí phồng ngoài dự đoán | Đã đo: prompt 15 token bị phồng thành **914 token** (891 cached). **Không ước tính chi phí theo độ dài prompt** — chỉ tin `usage` trả về |
| Đối soát tiền lệch | Hai nguồn khác nhau: CKey trả `x_ckey.cost` ngay, Vilao phải query `/api/v2/llm/usage` (`usage.cost` trong response **luôn = 0**) |
| Nhầm 503 của CKey là sàn sập | Đã đo: CKey trả **503 cho mọi path lạ**. Đừng dùng 503 làm tín hiệu health |
| Rò rỉ key upstream | Key chỉ ở server + SQLite. **PAT Vilao là full quyền gồm ví tiền** — cân nhắc PAT riêng nếu Vilao cho phép |
| Timeout quá ngắn | Đã đo **40 giây** cho 104 token output. Đặt timeout rộng, và tách riêng ngưỡng "chunk đầu" với "tổng thời gian" |
| Rate limit | Vilao API v2 **120 req/phút**; key có `rate_limit_rpm` riêng. Cache catalog, đừng sync mỗi request |
| Giá đổi giữa chừng | Chốt giá lúc gọi, hiện thời điểm sync trên UI |

## 8. Cân nhắc trước khi tự build

**LiteLLM proxy** và **one-api / new-api** đều là mã nguồn mở, đã làm sẵn: OpenAI-compatible, nhiều upstream, fallback, đếm tiền, phát hành key. Nếu bạn chỉ cần gộp hai sàn sau một endpoint, cài LiteLLM mất một buổi.

Cái chúng **không** hiểu là phần riêng của hai sàn này:

- Vilao bắt **subscribe từng model vào key** trước khi gọi — không relay nào biết bước này
- Vilao **công bố success_rate từng listing**; không relay nào biết đọc để định tuyến
- Cùng một model có **hàng chục listing giá chênh 14.6x** — LiteLLM định tuyến theo *model*, không theo *người bán trong một model*

Ba thứ đó chính là mục 2b, 2c, 2d — và cũng chính là lý do đáng tự build. Nếu bỏ chúng đi thì nên dùng LiteLLM.

Lựa chọn trung dung nếu muốn nhanh: dùng LiteLLM làm lớp vận chuyển, tự viết phần chọn listing rồi bơm xuống dưới dạng cấu hình. Mình **không khuyên** — ranh giới giữa hai bên sẽ rất rối, mà phần vận chuyển lại là phần dễ nhất.

## 9. Việc còn lại của M0

Thử một model video (`veo-3.1-lite` Vilao, 200 VND, thành công 66%) để biết gọi endpoint nào và trả về link hay base64. Chỉ ảnh hưởng M6, **không chặn M1–M5**.

## 10. Bước kế tiếp

Bắt đầu M1. Cần chốt hai điều:

1. Gateway có làm cả `/v1/messages` (Anthropic) không, hay chỉ OpenAI-compatible trước?
2. M1 gọi cứng upstream nào — CKey (không cần subscribe, đơn giản hơn) hay Vilao?

Gợi ý: **M1 dùng CKey**, vì không vướng bước subscribe. Vilao đưa vào ở M3 cùng lúc với định tuyến.
