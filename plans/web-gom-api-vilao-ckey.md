# Kế hoạch: Gateway API cá nhân trước Vilao & CKey

Ngày: 2026-09-03 · Trạng thái: v6 — bỏ video, rà soát lại toàn bộ · Khảo sát: `docs/api-notes.md`

## 1. Sản phẩm

Một **gateway OpenAI-compatible chạy local, chỉ cho text/chat**. Mọi công cụ (Claude Code, Cursor, Cline, script) trỏ base URL vào web của bạn thay vì trỏ thẳng vào Vilao hay CKey.

```
Cursor ─┐                    ┌─ pool "code-rẻ"  ─┐
Claude ─┼─→ gateway của bạn ─┼─ pool "code-xịn" ─┼─→ Vilao (x-api-key)
script ─┘   localhost:3000   └─ pool "rẻ-nhất"  ─┘   CKey  (Bearer)
                  │                                  lỗi → tụt listing kế
            key riêng của bạn
                  │
            log tiền · độ trễ · thành/bại
```

Bạn cấp key của **chính bạn** cho từng công cụ. Key thật của Vilao/CKey không bao giờ rời server.

**Ảnh và video nằm ngoài phạm vi.** Hai sàn đều có (`/v1/images/generations`, `/v1/videos/generations` đều tồn tại), nhưng tỷ lệ thành công của model video đo được chỉ 55–86% và nó kéo theo cả một nhánh kiến trúc khác (submit job, poll, lưu file). Nếu sau này cần thì làm thành dự án riêng, đừng nhét vào gateway text.

### Vì sao đáng làm

Ba con số từ khảo sát:

- Cùng `claude-opus-4-8`, người bán rẻ nhất **rẻ hơn 25 lần** người bán chính chủ mà tỷ lệ thành công gần bằng (99.0% so với 99.2%, đo trên 11.967 request)
- Trung vị chênh giá **14.6x** trên Vilao, **4.7x** trên CKey
- Cùng người bán `wowz` bán trên cả hai sàn, **CKey đắt hơn đều 20%**

Chọn tay giữa 1.102 listing từ 133 người bán là bất khả thi, và giá đổi ngay giữa phiên làm việc.

## 2. Pool — đơn vị định tuyến

**Một pool là một tên model do bạn đặt, đứng trước một nhóm listing đã sắp thứ tự.** Client gọi tên pool; gateway chọn thành viên để thực thi.

```
pool "opus"  →  1. rouyea/claude-opus-4-8      (Vilao,  300 VND, 99.0%, 11.967 req)
                2. nguy-n/claude-opus-4-8      (Vilao,  350 VND, 97.6%,  6.703 req)
                3. dungcsnd113/claude-opus-5   (CKey,   390 VND, chưa đo)
                4. vilao/claude-opus-4-8       (Vilao, 7500 VND, 99.2%, 849k req)  ← phao cứu sinh
```

Client chỉ thấy `"model": "opus"`. Đắt-nhưng-chắc để cuối làm lưới an toàn.

Pool giải quyết ba vấn đề cùng lúc: **tên model lệch nhau** (`claude-opus-4-8` / `claude-opus-4.8` / `dungcsnd113/claude-opus-5`), **ý định khác nhau** (pool `opus-rẻ` và `opus-chắc` sắp thứ tự khác nhau), và **catalog biến động** (listing chết thì tự tụt xuống, client không biết).

### Model không thuộc pool nào

Client có thể gửi thẳng id listing thật (`dungcsnd113/claude-opus-5`). Gateway **chuyển tiếp thẳng lên sàn tương ứng**, không 404. Pool là tiện ích, không phải rào chắn — và chế độ này chính là đường thoát khi định tuyến giở chứng.

### Hai kiểu thành viên

| Kiểu | Cách hoạt động | Dùng khi |
|---|---|---|
| **Tĩnh** | Chọn tay từng listing, thứ tự cố định | Pool quan trọng, kiểm soát tuyệt đối |
| **Theo luật** | Lưu một bộ filter; listing mới khớp tự vào | Muốn bắt được người bán rẻ mới xuất hiện |

Catalog CKey đã đo là **đổi trong vòng một giờ**, nên pool theo luật sẽ nuốt listing bạn chưa hề kiểm chứng. Vì vậy **mặc định đưa vào hàng chờ duyệt, không thả thẳng vào vòng chạy**, có công tắc "tự nhận" cho ai chấp nhận rủi ro.

### Chiến lược trong pool

| Chiến lược | Hành vi | Dùng khi |
|---|---|---|
| **Failover** (mặc định) | Luôn thử #1; hỏng mới xuống #2 | Muốn rẻ nhất |
| **Round-robin** | Chia đều lượt cho N thành viên đầu | Tránh chạm rate limit, trải rủi ro |
| **Trọng số** | Chia theo tỷ lệ đặt trước, ví dụ 80/20 | Giữ ấm listing dự phòng |
| **Ghim** | Luôn một listing | Đang debug, hoặc listing đó hợp việc |

Round-robin đáng lưu ý vì Vilao giới hạn **120 req/phút mỗi token**.

### Ràng buộc cấp pool

Trần chi tiêu ngày/tháng · trần giá mỗi request · timeout riêng cho chunk-đầu và cho tổng · số lần thử tối đa (mặc định 3).

## 3. Filter

Filter phục vụ hai việc: duyệt catalog, và định nghĩa pool theo luật. **Một cài đặt dùng chung** — tách đôi thì UI và runtime sẽ hiểu luật khác nhau.

### Độ phủ thật của các trường

Đã đếm trên dữ liệu thật; con số này quyết định filter nào dùng được:

| Trường | Vilao (604) | CKey (498) |
|---|---|---|
| Giá input theo token | 358 | 359 |
| Giá mỗi request | 259 | 223 |
| Sàn tối thiểu | 330 | 333 |
| Context length | 267 | 181 |
| **success_rate** | **501** | **0 — không công bố** |
| **total_requests** | **515** | **0** |
| **avg_latency_ms** | **515** | **0** |
| supports_tools | 414 | 0 |
| supports_vision | 326 | 0 |
| avg_rating | 119 | 0 |
| provider_verified | **chỉ 16** | 0 |
| last_test_score | **chỉ 25** | 0 |

Thêm trường của riêng gateway: tỷ lệ thành công tự đo, p50 TTFB, lần chạy được gần nhất, số lần đã gọi, cờ `stale` / `blocked` / `pinned`.

### Bẫy lớn nhất: trường rỗng

Lọc "chỉ verified" còn **16/604**. Lọc "chỉ có rating" còn 119. Và **mọi filter dựa trên chất lượng đều xoá sạch CKey**.

Nên filter **không được coi thiếu dữ liệu là 0 hay false**. Mỗi điều kiện chất lượng có ba trạng thái:

```
[ ] đạt ngưỡng    [ ] chưa có dữ liệu    [ ] không đạt
```

và UI **luôn hiện số lượng còn lại** sau mỗi điều kiện.

### Bộ lọc

```
Sàn        vilao · ckey
Loại       text · embedding        (bỏ image/video/tts/transcribe khỏi phạm vi)
Người bán  chọn nhiều / loại trừ
Giá        input ≤ X · output ≤ X · per_request ≤ X · sàn ≤ X
Chế độ giá token · request
Chất lượng success_rate ≥ X · total_requests ≥ N · latency ≤ X
           (+ công tắc "gồm cả listing chưa có dữ liệu")
Năng lực   supports_tools · supports_vision · context ≥ X
Của mình   đã kiểm chứng · chưa từng gọi · đang hỏng · đã ghim · đã chặn
Tên        khớp chuỗi / regex
```

Filter lưu được, đặt tên, và biến thẳng thành pool theo luật bằng một nút.

## 4. Năm quyết định kiến trúc khó

### 4a. Streaming giết chết fallback

Đã đẩy byte đầu về client thì không rút lại được. Mà streaming là bắt buộc.

Giải: **giữ lại chunk đầu tiên**. Chờ chunk hợp lệ đầu rồi mới ghi ra client. Mọi lỗi trước đó (401, 402, 429, 503, timeout, đứt) đều fallback được. Lỗi sau đó thì trả về kèm cờ, và tính vào thống kê thất bại của listing.

Đánh đổi một chút độ trễ token đầu. Đáng, vì phần lớn lỗi của sàn relay xảy ra lúc bắt tay.

### 4b. Vilao bắt subscribe trước khi gọi

Pool chọn thành viên lúc chạy, nhưng Vilao trả `FORBIDDEN` với model chưa subscribe.

Giải: **subscribe ngay lúc thêm thành viên vào pool**, không đợi lúc chạy — tránh cú chậm bất ngờ ở request đầu. Lúc chạy vẫn kiểm tra lại, thiếu thì subscribe rồi gọi; subscribe hỏng thì tụt xuống thành viên kế. CKey không có bước này.

### 4c. Học chất lượng của CKey mà không hại request thật

Vilao công bố `success_rate` trên 501 listing, có cái dựa trên 849.389 request — không cần và không thể đo lại. CKey **không công bố gì**.

Giải, ba tầng: listing chưa có dữ liệu **không bao giờ tự đứng đầu pool** · chỉ thăm dò thành viên lạ khi request **không streaming** và còn nguyên lượt fallback · **không tự bắn thử định kỳ**, chỉ học từ request thật.

### 4d. Phân loại lỗi, không chỉ chuẩn hoá

Ba envelope khác nhau:

```
CKey     {"error":{"message", "request_id", "type"}}
Vilao v1 {"error":{"code",    "message",    "type"}}
Vilao v2 {"error":{"code",    "message",    "hint"}}
```

Quan trọng hơn việc gộp về một dạng: **phân loại lỗi nào đáng fallback**. `429`, `503`, timeout thì có. `400` do prompt sai thì **không** — thử lại chỉ tốn tiền mà vẫn hỏng.

Cạm bẫy đã đo: **CKey trả 503 cho mọi path lạ**, không phải 404. Đừng dùng 503 làm tín hiệu sàn sập.

### 4e. Định tuyến theo giá không nhìn thấy chất lượng đầu ra

Đây là điểm mù lớn nhất của cả thiết kế, và mình muốn nói thẳng.

`success_rate` chỉ đo **"có trả về không"**, không đo **"trả về có tốt không"**. Một người bán rẻ hoàn toàn có thể lặng lẽ phục vụ model yếu hơn, lượng tử hoá nặng, context ngắn hơn, hoặc đổi hẳn sang model khác — mà vẫn đạt 99% "thành công". Đây là sàn bán lại, không phải nhà cung cấp gốc; giá rẻ hơn 25 lần thì phải có lý do ở đâu đó.

Gateway **không thể tự phát hiện** chuyện này bằng số liệu đang có. Ba cách giảm thiểu, không cách nào triệt để:

1. **Đối chiếu `actual_model`.** Bản ghi usage của Vilao có trường này — nếu nó khác model đã yêu cầu thì cảnh báo
2. **Tách pool theo mức độ quan trọng.** Việc quan trọng dùng pool ghim người bán đã tin; việc vặt dùng pool rẻ
3. **Tự chấm bằng mắt.** Thấy chất lượng tụt thì chặn listing đó, gateway ghi nhận

**Đừng kỳ vọng gateway tự bảo vệ bạn khỏi người bán gian.** Nó tối ưu giá trên trục nó đo được. Chấp nhận điều này ngay từ đầu thì đỡ thất vọng về sau.

## 5. Kiến trúc

**Next.js (App Router) + TypeScript + SQLite.** Một process vừa là gateway vừa là dashboard.

Nguyên tắc: **toàn bộ logic gateway nằm trong `lib/gateway/`, không import gì từ `next`.** Sau này muốn chạy headless tách khỏi UI thì bê nguyên thư mục sang server Node trần.

```
app/
  api/v1/chat/completions/route.ts   → OpenAI-compatible, streaming
  api/v1/messages/route.ts           → Anthropic, cho Claude Code
  api/v1/models/route.ts             → liệt kê pool
  page.tsx                           → dashboard
  catalog/    pools/    usage/    settings/
lib/gateway/            ← KHÔNG dính Next.js
  upstream/vilao.ts     → x-api-key; auto-subscribe; cost từ /api/v2/llm/usage
  upstream/ckey.ts      → Bearer; cost từ usage.x_ckey.cost
  catalog.ts  filter.ts  pool.ts  routing.ts
  pricing.ts            → max(sàn, per_request + token/1e6 × giá)
  stream.ts             → giữ chunk đầu, chuyển tiếp SSE
  errors.ts             → chuẩn hoá + phân loại có nên fallback
lib/db/
```

### Vận hành — điểm dễ bỏ sót

Gateway là **điểm chịu lỗi tập trung**: nó chết thì mọi công cụ chết.

- **Đừng chạy `npm run dev` làm gateway thật.** Build production rồi chạy dưới pm2 hoặc systemd, tự bật lại khi crash
- **SQLite bật WAL.** `better-sqlite3` là đồng bộ — ghi log đang giữa stream sẽ chặn event loop. Ghi sau khi stream xong, hoặc gom lô
- **Health check lúc khởi động**: gọi thử `/v1/models` mỗi upstream. Key chết thì báo ngay trên dashboard, đừng để phát hiện qua request hỏng
- **Chế độ bypass**: một công tắc trỏ thẳng một upstream, bỏ qua toàn bộ định tuyến, cho lúc đang sửa

### Luồng một request

```
1. Xác thực key phát hành                      → 401 nếu sai
2. Tên model → pool; không khớp pool → chuyển tiếp thẳng
3. Sắp thành viên theo chiến lược của pool
4. Kiểm tra trần chi tiêu                      → 402 nếu chạm
5. Với từng thành viên (tối đa N lần):
     a. Vilao và chưa subscribe → subscribe
     b. Gọi upstream
     c. Chờ chunk đầu hợp lệ
     d. Lỗi ĐÁNG fallback trước chunk đầu → thành viên kế
6. Chuyển tiếp stream về client
7. Ghi run cho MỌI lần thử, kể cả lần hỏng
```

Bước 7 quan trọng gấp đôi: vừa là dữ liệu chấm điểm, vừa là cách duy nhất thấy **fallback đang đốt bao nhiêu tiền**.

## 6. Chấm điểm listing

```
điểm = giá_ước_tính / độ_tin_cậy

độ_tin_cậy = Vilao : success_rate công bố, trộn số đo của mình khi đủ mẫu
             CKey  : tự đo, làm mượt Bayes về 0.8 khi mẫu còn ít
             trống : 0.5 — phạt nặng, không bao giờ đứng đầu
```

Ba quy tắc cứng, rút từ dữ liệu thật:

- **Xếp theo listing, không theo người bán.** `rouyea` vừa có listing 99.0% trên 11.967 request, vừa có listing **0% trên 1 request**
- **Mẫu nhỏ không phải bằng chứng.** "100% trên 1 request" xếp dưới "98% trên 10.000 request"
- **Rẻ bất thường là cờ đỏ.** Vài listing để 1 VND, gần như chắc chắn hỏng

## 7. Data model

- `client_key(id, name, key_hash, active, created_at)`
- `upstream(id, platform, base_url, api_key, pat, enabled)`
- `listing(id, upstream_id, external_id, seller, kind, pricing_json, published_stats_json, raw_json, synced_at, stale)`
- `pool(id, name, strategy, daily_budget, monthly_budget, max_price_per_request, max_attempts, ttfb_timeout_ms, total_timeout_ms)`
- `pool_member(pool_id, listing_id, position, weight, state)` — `state`: active / candidate / blocked
- `pool_rule(pool_id, filter_json, auto_admit)`
- `saved_filter(id, name, filter_json)`
- `subscription(listing_id, upstream_sub_id, subscribed_at)` — chỉ Vilao
- `run(id, client_key_id, pool_id, listing_id, attempt_no, tokens_in, tokens_out, cost_vnd, latency_ms, ttfb_ms, status, error_code, stream, created_at)`
- `listing_stat(listing_id, calls, failures, p50_ttfb, last_ok_at, last_error)`

**Đừng xoá cứng listing khi sync** — đánh dấu `stale`, kẻo `run` cũ mồ côi.

## 8. Các mốc

| Mốc | Nội dung | Xong khi |
|---|---|---|
| ~~**M1**~~ **XONG** Đường ống | `/v1/chat/completions`, CKey gọi cứng, key riêng, streaming, log | **Trỏ Cursor vào và code thật cả buổi** |
| ~~**M2**~~ **XONG** Catalog + Filter + `/v1/messages` | Sync hai sàn, trang duyệt, bộ lọc, endpoint Anthropic | Lọc "text, ≤500 VND, success ≥98%, ≥1000 req" và thấy số còn lại |
| ~~**M3**~~ **XONG** Pool | Pool tĩnh, kéo thả thứ tự, `/v1/models` trả tên pool, chuyển tiếp model lạ | Gọi `"model":"opus"` chạy qua thành viên #1 |
| ~~**M4** Định tuyến~~ | **XONG** — chiến lược, fallback, giữ chunk đầu, trần chi tiêu (Vilao + auto-subscribe đã làm ở M3) | Đạt: người bán CKey sập thật giữa lúc test, gateway tự tụt sang Vilao, client không thấy lỗi |
| **M5** Kế toán | Đối soát tiền hai bên, trang Usage, **tiền lãng phí do fallback** | Biết hôm nay tiêu bao nhiêu, tiết kiệm bao nhiêu, phí bao nhiêu cho lần thử hỏng |
| **M6** Pool theo luật + học chất lượng | `pool_rule`, hàng chờ duyệt, `listing_stat`, thăm dò có kiểm soát | Người bán rẻ mới tự vào hàng chờ; listing hỏng tự rơi hạng |

**M1 có giá trị ngay.** M3 là lúc pool trả công. M4 khó nhất. M6 là chỗ khác biệt so với mọi relay có sẵn.

`/v1/messages` gộp vào M2 vì lúc đó còn thuần CKey — CKey hỗ trợ sẵn ở upstream nên chỉ là chuyển tiếp, **không phải dịch envelope**. Sang M4 khi Vilao vào cuộc thì phải quyết: viết bộ dịch Anthropic↔OpenAI (kể cả giữa stream), hay **cấm pool trộn Anthropic với thành viên Vilao**. Ghi sẵn để đừng vấp.

## 9. Rủi ro

| Rủi ro | Xử lý |
|---|---|
| Gateway chết → mọi công cụ chết | Chạy dưới pm2/systemd, không phải `npm run dev`. Có chế độ bypass |
| **Người bán rẻ phục vụ model kém hơn** | Không phát hiện tự động được (§4e). Đối chiếu `actual_model`, tách pool theo mức quan trọng, tự chấm bằng mắt |
| **Fallback nhân đôi chi phí** | Mỗi lần thử hỏng vẫn có thể bị tính tiền — CKey tính `min_charge` cho từng lần. Hiện "tiền lãng phí" thành số riêng ở M5 |
| Pool theo luật nuốt listing rác | Mặc định vào hàng chờ duyệt |
| Filter âm thầm xoá sạch catalog | Luôn hiện số còn lại; "chưa có dữ liệu" là trạng thái riêng |
| Fallback vòng lặp | Trần số lần thử, trần chi tiêu, **không fallback sau khi đã stream** |
| Ước tính chi phí sai | Prompt 15 token phồng thành **914** (891 cached). Chỉ tin `usage` trả về |
| Đối soát tiền lệch | CKey trả `x_ckey.cost` ngay (kể cả trong stream); Vilao phải query `/api/v2/llm/usage` vì `usage.cost` **luôn = 0** |
| Nhầm 503 của CKey là sàn sập | CKey trả 503 cho **mọi path lạ** |
| Rò rỉ key upstream | Key chỉ ở server + SQLite. **PAT Vilao full quyền gồm ví tiền** |
| Timeout quá ngắn | Đã đo **40 giây** cho 104 token. Tách ngưỡng chunk-đầu và tổng |
| Rate limit | Vilao v2 **120 req/phút**; key có `rate_limit_rpm`. Round-robin trải tải; cache catalog |
| SQLite chặn event loop | `better-sqlite3` đồng bộ. Bật WAL, ghi log sau khi stream xong |

## 10. Cân nhắc trước khi tự build

**LiteLLM proxy** và **one-api / new-api** đã làm sẵn: OpenAI-compatible, đa upstream, fallback, đếm tiền, phát hành key. Chỉ cần gộp hai sàn sau một endpoint thì cài LiteLLM mất một buổi.

Chúng **không** hiểu ba thứ riêng của hai sàn này: Vilao bắt **subscribe từng model vào key**; Vilao **công bố success_rate từng listing** mà không relay nào đọc để định tuyến; và cùng một model có **hàng chục listing chênh 14.6x** — LiteLLM định tuyến theo *model*, pool ở đây định tuyến theo *listing trong một model*.

Ba thứ đó là §4b, §4c và toàn bộ khái niệm pool. Bỏ chúng đi thì nên dùng LiteLLM.

## 11. Bước kế tiếp

Bắt đầu M1 theo `plans/m1-duong-ong.md`.

Việc treo không chặn gì: **thu hồi PAT Vilao** ở `/console/user/api-tokens` — full quyền gồm ví tiền, đang nằm trong transcript session.
