# Kế hoạch: Gateway API cá nhân trước Vilao & CKey

Ngày: 2026-09-03 · Trạng thái: v5 — thêm Filter & Pool · Khảo sát: `docs/api-notes.md`

## 1. Sản phẩm

Một **gateway OpenAI-compatible chạy local**. Mọi công cụ (Claude Code, Cursor, Cline, script) trỏ base URL vào web của bạn thay vì trỏ thẳng vào Vilao hay CKey.

```
Cursor ─┐                    ┌─ pool "code-rẻ"  ─┐
Claude ─┼─→ gateway của bạn ─┼─ pool "code-xịn" ─┼─→ Vilao (x-api-key)
script ─┘   localhost:3000   └─ pool "video"    ─┘   CKey  (Bearer)
                  │                                  lỗi → tụt listing kế
            key riêng của bạn
                  │
            log tiền · độ trễ · thành/bại
```

Bạn cấp key của **chính bạn** cho từng công cụ. Key thật của Vilao/CKey không bao giờ rời server.

### Vì sao đáng làm

Ba con số từ khảo sát:

- Cùng `claude-opus-4-8`, người bán rẻ nhất **rẻ hơn 25 lần** người bán chính chủ mà tỷ lệ thành công gần bằng (99.0% so với 99.2%, đo trên 11.967 request)
- Trung vị chênh giá **14.6x** trên Vilao, **4.7x** trên CKey
- Cùng người bán `wowz` bán Veo trên cả hai sàn, **CKey đắt hơn đều 20%**

Chọn tay giữa 1.102 listing từ 133 người bán là bất khả thi, và giá đổi ngay giữa phiên làm việc.

## 2. Pool — đơn vị định tuyến

Đây là khái niệm trung tâm, thay cho "canonical model" ở bản trước.

**Một pool là một tên model do bạn đặt, đứng trước một nhóm listing đã sắp thứ tự.** Client gọi tên pool; gateway chọn thành viên trong pool để thực thi.

```
pool "opus"  →  1. rouyea/claude-opus-4-8      (Vilao,  300 VND, 99.0%, 11.967 req)
                2. nguy-n/claude-opus-4-8      (Vilao,  350 VND, 97.6%,  6.703 req)
                3. dungcsnd113/claude-opus-5   (CKey,   390 VND, chưa đo)
                4. vilao/claude-opus-4-8       (Vilao, 7500 VND, 99.2%, 849k req)  ← phao cứu sinh
```

Client chỉ thấy `"model": "opus"`. Bên trong, gateway thử lần lượt, đắt-nhưng-chắc để cuối làm lưới an toàn.

Pool giải quyết gọn ba vấn đề cùng lúc:

- **Tên model lệch nhau** — `claude-opus-4-8` / `claude-opus-4.8` / `dungcsnd113/claude-opus-5` cùng nằm một pool, bạn tự đặt tên chung
- **Ý định khác nhau** — cùng model nhưng pool `opus-rẻ` và pool `opus-chắc` sắp thứ tự khác nhau
- **Catalog biến động** — listing chết thì pool tự tụt xuống thành viên kế, client không biết gì

### Hai kiểu thành viên

| Kiểu | Cách hoạt động | Dùng khi |
|---|---|---|
| **Tĩnh** | Bạn chọn tay từng listing, thứ tự cố định | Pool quan trọng, muốn kiểm soát tuyệt đối |
| **Theo luật** | Lưu một bộ filter; listing mới khớp luật tự vào pool | Muốn tự bắt được người bán rẻ mới xuất hiện |

Pool theo luật là con dao hai lưỡi: catalog CKey đã đo là **đổi trong vòng một giờ**, nên listing mới sẽ tự chui vào pool mà bạn chưa hề kiểm chứng. Vì vậy:

**Pool theo luật mặc định đưa listing mới vào hàng chờ duyệt, không thả thẳng vào vòng chạy.** Có công tắc "tự nhận" cho ai chấp nhận rủi ro. Và dù ở chế độ nào, luật xếp hạng ở §6 vẫn giữ listing chưa kiểm chứng khỏi vị trí số 1.

### Chiến lược trong pool

| Chiến lược | Hành vi | Dùng khi |
|---|---|---|
| **Failover** (mặc định) | Luôn thử #1; hỏng mới xuống #2 | Muốn rẻ nhất, chấp nhận thỉnh thoảng chậm |
| **Round-robin** | Chia đều lượt cho N thành viên đầu | Tránh đụng rate limit một người bán, và trải rủi ro |
| **Trọng số** | Chia theo tỷ lệ bạn đặt, ví dụ 80/20 | Vừa dùng listing rẻ, vừa giữ ấm listing dự phòng |
| **Ghim** | Luôn một listing, không tự chọn | Đang debug, hoặc listing đó đặc biệt hợp việc |

Round-robin đáng lưu ý vì Vilao giới hạn **120 req/phút mỗi token** và mỗi key có `rate_limit_rpm` riêng — dồn hết vào một listing sẽ chạm trần sớm.

### Ràng buộc cấp pool

- **Trần chi tiêu** ngày/tháng. Chạm trần thì pool từ chối, không âm thầm tiêu tiếp
- **Trần giá mỗi request** — bỏ qua thành viên nào đắt hơn ngưỡng
- **Timeout** riêng: một cho "chunk đầu", một cho tổng thời gian
- **Số lần thử tối đa** (mặc định 3)

## 3. Filter

Filter phục vụ hai việc: duyệt catalog, và **định nghĩa pool theo luật**. Cùng một bộ điều kiện.

### Các trường lọc được, kèm độ phủ thật

Đã đếm trên dữ liệu thật, con số này quyết định filter nào dùng được:

| Trường | Vilao (604) | CKey (498) |
|---|---|---|
| Giá input theo token | 358 | 359 |
| Giá mỗi request | 259 | 223 |
| Sàn tối thiểu | 330 | 333 |
| Context length | 267 | 181 |
| **success_rate** | **501** | **0 — không công bố** |
| **total_requests** | **515** | **0** |
| **avg_latency_ms** | **515** | **0** |
| avg_rating | 119 | 0 |
| supports_tools | 414 | 0 |
| supports_vision | 326 | 0 |
| provider_verified | **chỉ 16** | 0 |
| last_test_score | **chỉ 25** | 0 |

Thêm các trường của riêng gateway: tỷ lệ thành công tự đo, p50 TTFB, lần chạy được gần nhất, số lần đã gọi, cờ `stale` / `blocked` / `pinned`.

### Bẫy lớn nhất của filter: trường rỗng

Nhiều trường rất thưa. Lọc "chỉ lấy verified" còn **16/604 listing**. Lọc "chỉ lấy có rating" còn 119. Và **mọi filter dựa trên chất lượng đều xoá sạch CKey**, vì CKey không công bố gì.

Nên filter **không được coi thiếu dữ liệu là 0 hay false**. Mỗi điều kiện chất lượng phải có ba trạng thái rõ ràng:

```
[ ] đạt ngưỡng    [ ] chưa có dữ liệu    [ ] không đạt
```

và UI **luôn hiện số lượng còn lại** sau mỗi điều kiện, để bạn thấy ngay lúc vừa lọc mất 90% catalog.

### Bộ lọc

```
Sàn        vilao · ckey
Loại       text · image · video · embedding · tts · transcribe
Người bán  chọn nhiều / loại trừ
Giá        input ≤ X · output ≤ X · per_request ≤ X · sàn ≤ X
Chế độ giá token · request
Chất lượng success_rate ≥ X · total_requests ≥ N · latency ≤ X
           (kèm công tắc "gồm cả listing chưa có dữ liệu")
Năng lực   supports_tools · supports_vision · context ≥ X
Của mình   đã kiểm chứng · chưa từng gọi · đang hỏng · đã ghim · đã chặn
Tên        khớp chuỗi / regex
```

Filter lưu lại được, đặt tên, và **biến thẳng thành pool theo luật** bằng một nút.

## 4. Bốn quyết định kiến trúc khó

### 4a. Streaming giết chết fallback

Khi đã đẩy byte đầu tiên về client, **không thể rút lại để gọi thành viên khác**. Mà streaming là bắt buộc.

Giải: **giữ lại chunk đầu tiên**. Chờ chunk hợp lệ đầu tiên rồi mới bắt đầu ghi ra client. Mọi lỗi trước đó (401, 402, 429, 503, timeout, upstream đứt) đều fallback được. Lỗi sau đó thì đành trả về, kèm cờ, và **tính vào thống kê thất bại của listing**.

Đánh đổi một chút độ trễ token đầu. Đáng, vì phần lớn lỗi của sàn relay xảy ra ngay lúc bắt tay.

### 4b. Vilao bắt subscribe trước khi gọi

Không gọi được model mà key chưa subscribe — trả `FORBIDDEN`. Nhưng pool chọn thành viên **lúc chạy**.

Giải: **tự subscribe khi cần**. Trước khi gọi một listing Vilao lần đầu, `POST /api/v2/llm/keys/:id/subscriptions`, ghi vào DB, rồi gọi. Subscribe hỏng → coi như thành viên không khả dụng, tụt xuống kế tiếp. CKey không có bước này.

Hệ quả cho pool: **thêm thành viên Vilao vào pool nên subscribe ngay lúc thêm**, không đợi đến lúc chạy. Đỡ một cú chậm bất ngờ ở request đầu.

### 4c. Học chất lượng của CKey mà không hại request thật

Vilao công bố sẵn `success_rate` trên 501 listing, có listing dựa trên 849.389 request — không cần và không thể đo lại. CKey **không công bố gì**.

Giải, ba tầng:
1. **Mặc định an toàn** — listing chưa có dữ liệu không bao giờ tự đứng đầu pool
2. **Thăm dò có kiểm soát** — chỉ thử thành viên lạ khi request **không streaming** và còn nguyên lượt fallback; hỏng thì tụt xuống, bạn không thấy gì
3. **Không tự bắn thử** — chỉ học từ request bạn thật sự cần

### 4d. Ba envelope lỗi

```
CKey     {"error":{"message", "request_id", "type"}}
Vilao v1 {"error":{"code",    "message",    "type"}}
Vilao v2 {"error":{"code",    "message",    "hint"}}
```

Phải quy về một dạng nội bộ, và quan trọng hơn: **phân loại được lỗi nào đáng fallback**. `429` và `503` thì có; `400` do prompt sai thì không — thử lại chỉ tốn tiền mà vẫn hỏng.

Cạm bẫy đã đo: **CKey trả 503 cho mọi path lạ**, không phải 404. Đừng dùng 503 làm tín hiệu sàn sập.

## 5. Kiến trúc

**Next.js (App Router) + TypeScript + SQLite.** Một process vừa là gateway vừa là dashboard.

Nguyên tắc: **toàn bộ logic gateway nằm trong `lib/gateway/`, không dính framework.** Sau này muốn gateway chạy headless tách khỏi UI thì bê nguyên thư mục sang server Node trần. Đừng để logic định tuyến rò vào route handler.

```
app/
  api/v1/chat/completions/route.ts   → OpenAI-compatible, streaming
  api/v1/messages/route.ts           → Anthropic, cho Claude Code
  api/v1/models/route.ts             → liệt kê các pool
  page.tsx                           → dashboard: request gần đây, tiền, sức khoẻ
  catalog/                           → duyệt + filter 1.102 listing
  pools/                             → tạo/sửa pool, kéo thả thứ tự, hàng chờ duyệt
  usage/                             → chi tiêu theo ngày / pool / listing
  settings/                          → key upstream, key phát hành
lib/gateway/            ← KHÔNG dính Next.js
  upstream/
    vilao.ts            → x-api-key; auto-subscribe; cost từ /api/v2/llm/usage
    ckey.ts             → Bearer; cost từ usage.x_ckey.cost
  catalog.ts            → sync hai sàn
  filter.ts             → bộ vị từ dùng chung cho UI và pool theo luật
  pool.ts               → giải tên pool → danh sách thành viên đã sắp
  routing.ts            → chấm điểm, chiến lược, chuỗi fallback
  pricing.ts            → max(sàn, per_request + token/1e6 × giá)
  stream.ts             → giữ chunk đầu, chuyển tiếp SSE
  errors.ts             → chuẩn hoá lỗi + phân loại có nên fallback
lib/db/
```

`filter.ts` dùng chung cho cả trang catalog lẫn pool theo luật — **một cài đặt, không phải hai**. Nếu tách đôi thì sớm muộn UI và runtime sẽ hiểu luật khác nhau.

### Luồng một request

```
1. Xác thực key của bạn                       → 401 nếu sai
2. Tên model → pool                           → pool.ts
3. Sắp thành viên theo chiến lược của pool    → routing.ts
4. Kiểm tra trần chi tiêu của pool            → 402 nếu chạm
5. Với từng thành viên (tối đa N lần):
     a. Vilao và chưa subscribe → subscribe
     b. Gọi upstream
     c. Chờ chunk đầu hợp lệ
     d. Lỗi đáng fallback trước chunk đầu → thành viên kế
6. Chuyển tiếp stream về client
7. Ghi run cho MỌI lần thử, kể cả lần hỏng
```

Bước 7 quan trọng: lần thử hỏng chính là dữ liệu quý nhất để chấm điểm.

## 6. Chấm điểm listing

```
điểm = giá_ước_tính / độ_tin_cậy

độ_tin_cậy = Vilao : success_rate công bố, trộn với số đo của mình khi đã đủ mẫu
             CKey  : tự đo, làm mượt Bayes về 0.8 khi mẫu còn ít
             trống : 0.5 — phạt nặng, không bao giờ đứng đầu
```

Ba quy tắc cứng, rút từ dữ liệu thật:

- **Xếp theo listing, không theo người bán.** `rouyea` vừa có listing 99.0% trên 11.967 request, vừa có listing **0% trên 1 request**
- **Mẫu nhỏ không phải bằng chứng.** "100% trên 1 request" phải xếp dưới "98% trên 10.000 request"
- **Rẻ bất thường là cờ đỏ.** Vài listing để 1 VND, gần như chắc chắn hỏng

## 7. Data model

- `client_key(id, name, key_hash, active, created_at)`
- `upstream(id, platform, base_url, api_key, pat, enabled)`
- `listing(id, upstream_id, external_id, seller, kind, pricing_json, published_stats_json, raw_json, synced_at, stale)`
- `pool(id, name, strategy, daily_budget, monthly_budget, max_price_per_request, max_attempts, ttfb_timeout_ms, total_timeout_ms)`
- `pool_member(pool_id, listing_id, position, weight, state)` — `state`: active / candidate / blocked
- `pool_rule(pool_id, filter_json, auto_admit)` — pool theo luật
- `saved_filter(id, name, filter_json)`
- `subscription(listing_id, upstream_sub_id, subscribed_at)` — chỉ Vilao
- `run(id, client_key_id, pool_id, listing_id, attempt_no, tokens_in, tokens_out, cost_vnd, latency_ms, ttfb_ms, status, error_code, stream, created_at)`
- `listing_stat(listing_id, calls, failures, p50_ttfb, last_ok_at, last_error)`

`pool_member.state = candidate` là hàng chờ duyệt của pool theo luật.

**Đừng xoá cứng listing khi sync** — đánh dấu `stale`. Đã đo catalog CKey đổi trong một giờ, và `run` cũ sẽ mồ côi.

## 8. Các mốc

| Mốc | Nội dung | Xong khi |
|---|---|---|
| **M1** Đường ống | `/v1/chat/completions`, một upstream cứng, key riêng, streaming | **Trỏ Cursor vào localhost:3000/v1 và code được thật** |
| **M2** Catalog + Filter | Sync hai sàn, trang duyệt, bộ lọc đầy đủ, lưu filter | Lọc ra "text, ≤500 VND, success ≥98%, ≥1000 request" và thấy số lượng còn lại |
| **M3** Pool | Tạo pool tĩnh, kéo thả thứ tự, `/v1/models` trả tên pool | Gọi `"model":"opus"` và nó chạy qua thành viên #1 |
| **M4** Định tuyến | Chiến lược, fallback, giữ chunk đầu, auto-subscribe, trần chi tiêu | Rút phích thành viên đầu → request vẫn xong qua #2, client không biết |
| **M5** Kế toán | Ghi mọi lần thử, đối soát tiền hai bên, trang Usage | Biết hôm nay tiêu bao nhiêu, tiết kiệm bao nhiêu so với giá chính chủ |
| **M6** Pool theo luật + học chất lượng | `pool_rule`, hàng chờ duyệt, `listing_stat`, thăm dò có kiểm soát | Người bán rẻ mới xuất hiện tự vào hàng chờ; listing hỏng tự rơi hạng |
| **M7** Ảnh & video | `/v1/images/generations`, `/v1/videos/generations`, lưu file | Sinh một clip Veo, file nằm trên máy |

**M1 có giá trị ngay** — dùng gateway hàng ngày được dù chưa thông minh. M3 là lúc pool bắt đầu trả công. M4 khó nhất. M6 là chỗ khác biệt so với mọi relay có sẵn.

Thêm `/v1/messages` (Anthropic) ở M1 hoặc M2 nếu muốn trỏ Claude Code vào — CKey hỗ trợ sẵn upstream. Lưu ý `ANTHROPIC_BASE_URL` dùng **root domain, không có `/v1`**.

## 9. Rủi ro

| Rủi ro | Xử lý |
|---|---|
| Gateway chết → mọi công cụ chết | Điểm chịu lỗi tập trung. Giữ M1 thật đơn giản; có chế độ bypass trỏ thẳng một upstream |
| Pool theo luật nuốt listing rác | Mặc định vào hàng chờ duyệt, không thả thẳng vào vòng chạy |
| Filter âm thầm xoá sạch catalog | Luôn hiện số lượng còn lại; "chưa có dữ liệu" là trạng thái riêng, không phải false |
| Fallback vòng lặp đốt tiền | Trần số lần thử, trần chi tiêu pool, **không bao giờ fallback sau khi đã stream** |
| Chi phí phồng ngoài dự đoán | Đã đo: prompt 15 token phồng thành **914 token** (891 cached). **Không ước tính theo độ dài prompt** — chỉ tin `usage` trả về |
| Đối soát tiền lệch | CKey trả `x_ckey.cost` ngay; Vilao phải query `/api/v2/llm/usage` vì `usage.cost` **luôn = 0** |
| Nhầm 503 của CKey là sàn sập | CKey trả 503 cho **mọi path lạ**. Đừng dùng làm tín hiệu health |
| Rò rỉ key upstream | Key chỉ ở server + SQLite. **PAT Vilao full quyền gồm ví tiền** |
| Timeout quá ngắn | Đã đo **40 giây** cho 104 token output. Tách ngưỡng chunk-đầu và ngưỡng tổng |
| Rate limit | Vilao v2 **120 req/phút**; key có `rate_limit_rpm`. Round-robin để trải tải; cache catalog |

## 10. Cân nhắc trước khi tự build

**LiteLLM proxy** và **one-api / new-api** đã làm sẵn: OpenAI-compatible, đa upstream, fallback, đếm tiền, phát hành key. Chỉ cần gộp hai sàn sau một endpoint thì cài LiteLLM mất một buổi.

Chúng **không** hiểu ba thứ riêng của hai sàn này:

- Vilao bắt **subscribe từng model vào key** trước khi gọi
- Vilao **công bố success_rate từng listing**, không relay nào đọc để định tuyến
- Cùng một model có **hàng chục listing chênh 14.6x** — LiteLLM định tuyến theo *model*, pool ở đây định tuyến theo *listing trong một model*

Ba thứ đó là §4b, §4c và toàn bộ khái niệm pool — cũng chính là lý do đáng tự build. Bỏ chúng đi thì nên dùng LiteLLM.

## 11. Bước kế tiếp

Bắt đầu M1. Cần chốt:

1. Gateway làm cả `/v1/messages` (Anthropic) hay chỉ OpenAI-compatible trước?
2. M1 gọi cứng upstream nào? Gợi ý **CKey** — không vướng subscribe nên đơn giản hơn; Vilao vào ở M4.

Việc thử model video (`veo-3.1-lite`, 200 VND, thành công 66%) chỉ ảnh hưởng M7, không chặn M1–M6.
