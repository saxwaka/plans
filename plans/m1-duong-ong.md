# M1 — Đường ống

Mốc đầu của gateway. Kế hoạch tổng: `plans/web-gom-api-vilao-ckey.md` · Khảo sát: `docs/api-notes.md`

## Mục tiêu

**Trỏ Cursor vào `http://localhost:3000/v1` và code được thật cả buổi.**

Chỉ vậy. Chưa pool, chưa filter, chưa định tuyến, chưa fallback. Một đường ống chạy được, có thật, dùng hàng ngày — rồi mới xây thông minh lên trên.

Lý do làm mỏng thế này: gateway là **điểm chịu lỗi tập trung**. Khi nó hỏng thì mọi công cụ của bạn hỏng theo. Phải sống với một phiên bản đơn giản đủ lâu để tin nó, trước khi thêm logic có thể hỏng.

## Hai quyết định đã chốt

### 1. M1 chỉ OpenAI-compatible. `/v1/messages` để M2

Nhưng có một phát hiện làm đổi cách xếp việc: **CKey hỗ trợ sẵn `/v1/messages` ở upstream.** Nghĩa là khi chỉ có CKey, gateway chuyển tiếp thẳng, **không phải dịch envelope** — gần như miễn phí.

Nó chỉ đắt khi Vilao vào cuộc ở M4, vì Vilao **chỉ nói OpenAI**. Lúc đó một request Anthropic định tuyến sang Vilao sẽ cần dịch hai chiều, kể cả trong stream.

Kết luận: thêm `/v1/messages` ở M2 khi còn thuần CKey thì rẻ. Và ghi nhớ sẵn — **tại M4 phải quyết: hoặc viết bộ dịch, hoặc cấm pool trộn Anthropic với thành viên Vilao.** Đừng để đến lúc đó mới phát hiện.

### 2. M1 gọi cứng CKey

| | CKey | Vilao |
|---|---|---|
| Subscribe trước khi gọi | không | **có, thêm cả một cơ chế** |
| Catalog | public, không cần key | cần PAT |
| Chi phí mỗi request | **sẵn trong response** | phải gọi thêm API v2 |
| Số token cần giữ | 1 | 2 (`sk-` + `pat-`) |

CKey rẻ hơn hẳn về công sức cho một đường ống. Vilao vào ở M4 cùng lúc với định tuyến, khi đã có chỗ đặt cơ chế subscribe.

## Việc, theo thứ tự

Mỗi việc là một commit chạy được.

### T1 — Khung dự án
Next.js App Router + TypeScript + SQLite (`better-sqlite3`). Thư mục `lib/gateway/` **không import gì từ `next`**.

Xong khi: `npm run dev` lên được, trang chủ trắng trơn cũng được.

### T2 — Bảng và cấu hình
Chỉ ba bảng cho M1: `client_key`, `upstream`, `run`.
Key upstream đọc từ `.env.local`, chưa cần trang Settings.

Xong khi: chạy migration ra file `.db`, seed được một `client_key` bằng script.

### T3 — Xác thực key phát hành
Middleware đọc `Authorization: Bearer`, tra `key_hash`, 401 nếu sai.
**Hash key trước khi lưu**, đừng lưu thô.

Xong khi: gọi bằng key đúng thì qua, key sai thì 401 đúng format lỗi OpenAI.

### T4 — Chuyển tiếp không streaming
`POST /v1/chat/completions` với `stream: false`. Chuyển thân request thẳng lên `api.xah.io/v1`, gắn `Authorization: Bearer <CKEY>`, trả nguyên response về.

Xong khi:
```bash
curl localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer <key-cua-ban>" -H 'Content-Type: application/json' \
  -d '{"model":"dungcsnd113/claude-opus-5","max_tokens":16,
       "messages":[{"role":"user","content":"Say OK"}]}'
```
trả về giống hệt như gọi thẳng CKey.

### T5 — Chuyển tiếp streaming
`stream: true`. Chuyển tiếp SSE bằng `ReadableStream`, **không đệm toàn bộ**.

Ba chỗ dễ sai, kiểm riêng từng chỗ:
- Header phải là `text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`
- **Không được để runtime nén hay đệm** — nén là chữ chỉ hiện ra khi kết thúc
- Client ngắt giữa chừng → phải huỷ luôn request upstream, đừng để nó chạy tiếp mà vẫn tính tiền

Xong khi: chạy `curl -N` thấy chữ ra dần, không ra một cục.

### T6 — Ghi log request
Mỗi request ghi một dòng `run`: model, tokens, `cost_vnd` lấy từ `usage.x_ckey.cost`, `latency_ms`, `ttfb_ms`, `status`, `stream`.

**Tin tốt, đã kiểm chứng bằng request thật:** CKey gửi `usage` kèm `x_ckey.cost` **ngay trong stream mà không cần gửi `stream_options.include_usage`**. Chunk áp chót có dạng:

```
data: {"choices":[],"usage":{"completion_tokens":4,"prompt_tokens":6,"total_tokens":10,
       "x_ckey":{"cost":23.4,"request_id":"req_c3d3..."}}}
data: [DONE]
```

Nên chỉ việc bóc dòng SSE ngay trước `[DONE]`. Lưu ý chunk đó có `"choices":[]` rỗng — chuyển tiếp nguyên vẹn, đừng lọc bỏ.

Ghi DB **sau khi stream xong**, đừng ghi giữa chừng — `better-sqlite3` là đồng bộ, sẽ chặn event loop.

Xong khi: gọi 5 lần, `SELECT * FROM run` ra đủ 5 dòng có tiền thật.

### T7 — `/v1/models`
Trả danh sách model CKey (đã cache) đúng format OpenAI. Cursor cần endpoint này để hiện dropdown.

Xong khi: Cursor nạp được danh sách model.

### T8 — Dashboard tối giản
Một trang: 50 request gần nhất, tổng tiền hôm nay. Chưa cần đẹp.

Xong khi: nhìn một cái biết gateway đang sống và tiêu bao nhiêu.

### T9 — Nghiệm thu thật
Trỏ Cursor vào, dùng nửa buổi làm việc thật.

Xong khi: **không phải trỏ ngược về CKey lần nào.**

## Cạm bẫy đã biết, đừng vấp lại

Rút từ khảo sát, không phải phòng xa chung chung:

| Bẫy | Đã đo được gì | Phải làm |
|---|---|---|
| Timeout quá ngắn | **40 giây** cho 104 token output | Timeout ≥ 120s. Tách ngưỡng chunk-đầu và ngưỡng tổng |
| Nhầm 503 là sàn sập | CKey trả **503 cho mọi path lạ** | Đừng dùng 503 làm tín hiệu health |
| Ước tính tiền theo độ dài prompt | Prompt 15 token phồng thành **914** (891 cached) | Chỉ tin `usage` trả về |
| Bỏ sót `usage` khi stream | Đã kiểm chứng: có sẵn, không cần `stream_options` | Bóc dòng SSE ngay trước `[DONE]` |
| Giá đổi giữa chừng | Một listing thêm `min_charge` sau vài giờ | Đọc `x_ckey.cost`, đừng tự tính lại |
| Công thức giá sai | Request nhỏ bị **sàn quyết định**, không phải token | `max(sàn, per_request + token/1e6 × giá)` |

## Cố tình chưa làm ở M1

Pool · filter · định tuyến · fallback · Vilao · auto-subscribe · giữ chunk đầu · trần chi tiêu · học chất lượng.

Có một cái đáng nói: **M1 chưa có fallback, nên listing hỏng là request hỏng.** Chấp nhận được, vì mục tiêu M1 là kiểm chứng đường ống chứ không phải độ bền. Nhưng hãy gọi cứng một listing **đã kiểm chứng** (`dungcsnd113/claude-opus-5` đã chạy thật), đừng chọn listing rẻ nhất chưa biết ra sao.

## Ước lượng

7 việc code, mỗi việc nhỏ. T5 (streaming) tốn nhiều thời gian nhất — SSE bao giờ cũng có vài chỗ khó chịu. T9 là chờ, không phải code.

## Sau M1

M2 làm ba việc: catalog, filter, và `/v1/messages` (đang rẻ vì còn thuần CKey). Rồi M3 pool.

Ảnh và video **đã bỏ khỏi phạm vi** — xem §1 của kế hoạch tổng.

## Còn treo, không chặn M1

- **Thu hồi PAT Vilao** ở `/console/user/api-tokens`; nó full quyền gồm cả ví tiền, và đã nằm trong transcript session
