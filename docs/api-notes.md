# M0 — Kết quả khảo sát API (2026-09-03)

Khảo sát thật bằng curl, không đoán. Cập nhật lần 2 sau khi có key của cả hai bên.

---

## CKey — xong

### Base URL

Có **hai** host cùng phục vụ, cùng dữ liệu:

| Host | Ghi chú |
|---|---|
| `https://api.xah.io/v1` | Base URL chính thức, ghi trong trang `ckey.vn/llm-api/setup`. **Hiện bị chặn egress** trong môi trường này |
| `https://ckey.vn/v1` | Hoạt động, và `/v1/models` **không cần auth** |

Dùng `ckey.vn/v1` làm mặc định trong app; cho phép đổi ở Settings.

### Xác thực

```
Authorization: Bearer sk-xxx
```

### Ba giao thức song song

Đây là điểm bất ngờ — CKey không chỉ nói OpenAI:

| Giao thức | Endpoint | Base URL cần dùng |
|---|---|---|
| OpenAI | `/v1/chat/completions` | có `/v1` |
| Anthropic | `/v1/messages` | **root domain, không có `/v1`** (`ANTHROPIC_BASE_URL`) |
| Gemini | `/v1beta/models/{model}:generateContent` | — |
| Ollama | `/api/chat`, `/api/generate` | — |

Trích nguyên văn từ trang setup: *"OpenAI-compatible clients: use the base URL with `/v1`. Claude Code `ANTHROPIC_BASE_URL`: use the root domain without `/v1`."*

### Các route tồn tại (GET trả 401 = có route, cần auth)

```
/v1/models              200  (public, không cần key)
/v1/chat/completions    401
/v1/messages            401
/v1/responses           401
/v1/embeddings          401
/v1/images/generations  401
/v1/videos/generations  401
/v1/video/generations   401
/v1/audio/speech        401
```

Có cả ảnh, video, TTS, embeddings. Vision hỗ trợ qua `image_url` base64 hoặc URL trực tiếp (có ví dụ curl trong trang setup).

### Schema `/v1/models`

498 model. Object mẫu:

```json
{
  "id": "phuocanh421994/Qwen-Image-2.0-Pro",
  "object": "model",
  "root": "phuocanh421994/Qwen-Image-2.0-Pro",
  "parent": null,
  "owned_by": "ckey.vn",
  "created": 1787657360,
  "context": 0,
  "max_output": 0,
  "permission": [],
  "pricing": { "per_request": 25, "unit": "VND" }
}
```

Các khoá trong `pricing` (không phải model nào cũng đủ):

| Khoá | Có trên | Ý nghĩa |
|---|---|---|
| `unit` | 498/498 | Luôn là `"VND"` |
| `input` / `prompt` | 365 | **Giống hệt nhau** — 0 model nào khác nhau. Chỉ cần đọc một |
| `output` / `completion` | 360 | Cũng là cặp trùng nhau |
| `min_charge_per_request` | 333 | Sàn tính tiền mỗi request |
| `per_request` | 223 | Phí phẳng mỗi lần gọi |
| `cache_write` / `cache_read` | ~177 | Giá đọc/ghi cache |

**127 model chỉ có `per_request`, không có giá token.** Model ảnh/video hầu hết thuộc nhóm này. Nghĩa là công thức tính tiền phải xử lý cả hai chế độ, không thể giả định luôn tính theo token.

`context: 0` nghĩa là không khai báo, không phải context bằng 0.

### Đơn vị giá — CHƯA CHỐT

`unit` chỉ ghi `"VND"`, không nói trên bao nhiêu token. Trang web có nhãn "Per token" / "Per request" nhưng không nêu bội số.

Suy đoán: **VND / 1 triệu token**. Căn cứ: `qwen3.8-27b` input = 1575. Nếu tính trên 1M token thì ≈ $0.06/M — hợp lý cho model nhỏ. Nếu tính trên 1K token thì thành $60/M — vô lý.

Cách xác nhận dứt điểm: gọi thật một request nhỏ, đối chiếu số tiền bị trừ với `usage.prompt_tokens` trả về. Làm ở M1.

### Marketplace nhiều người bán — phát hiện quan trọng nhất

467/498 id có dạng `nguoiban/ten-model`, **69 người bán khác nhau**. Cùng một model được nhiều người bán song song với giá rất khác nhau.

`claude-opus-5` có 16 người bán:

```
anhyeu00m/claude-opus-5          input=416    output=650
dungcsnd113/claude-opus-5        input=390    output=780
Ntthin/claude-opus-5             input=650    output=2600
claude-opus-5        (chính chủ) input=3000   output=14500
vuduythanh2023/claude-opus-5     input=5000   output=20000
```

47 model có từ 2 người bán trở lên. **Trung vị mức chênh giá input là 4.7 lần.** `gpt-image-2` giống hệt nhau: một người bán 960 VND, người khác 1600 VND.

Cảnh báo: vài listing để giá 1 VND (`gemini-3.1-pro` chênh tới 6923x) — nhiều khả năng là listing hỏng hoặc mồi câu, không phải món hời. **Rẻ nhất không đồng nghĩa dùng được.** Cần đo độ tin cậy thật, không chỉ đọc giá. CKey có trang `/leaderboard` — nên xem có phải xếp hạng người bán không.

### Model ảnh / video có thật

| Model | Người bán | Giá |
|---|---|---|
| `wowztools/Veo-3.1-Lite` | wowztools | 240 VND/request |
| `wowztools/Veo-3.1-Fast` | wowztools | 300 VND/request |
| `wowztools/Veo-3.1-Quality` | wowztools | 1200 VND/request |
| `danielnguyenkarate/gpt-image-2` | danielnguyenkarate | 960 VND/request |
| `thanhnhan9023/gpt-image-2` | thanhnhan9023 | 1600 VND/request |
| `adminsgehdt/FLUX-2-max` | adminsgehdt | 1100 VND/request |
| `phuocanh421994/Qwen-Image-2.0-Pro` | phuocanh421994 | 25 VND/request |
| `danielnguyenkarate/z-image-turbo` | danielnguyenkarate | 60 VND/request |

Chưa rõ Veo gọi qua `/v1/videos/generations` hay `/v1/chat/completions`, và trả về link hay base64. Cần key để thử.

### Lấy lại snapshot

Không cần key:

```bash
curl -sS https://ckey.vn/v1/models -o docs/samples/ckey-models.json
```

---

## Vilao — có HAI API riêng biệt

Đây là điều quan trọng nhất về Vilao, và mình đã bỏ sót ở vòng dò đầu tiên vì chỉ soi `api.vilao.ai`.

| | API suy luận (v1) | API quản lý (v2) |
|---|---|---|
| Host | `https://api.vilao.ai/v1` | `https://vilao.ai/api/v2` |
| Dùng để | Gọi model | Quản lý key, catalog, số dư, usage |
| Token | LLM key `sk-...` | **Personal Access Token `pat-...`** |
| Header | `x-api-key` | `Authorization: Bearer pat-...` |

Hai loại token **không dùng thay nhau được**. Đưa `sk-...` cho v2 sẽ nhận:

```json
{"error":{"code":"auth/invalid-token-type","message":"Invalid token",
  "suggestion":"API v2 requires a Personal Access Token (pat-xxx). Get one at /console/user/api-tokens"}}
```

### Bẫy xác thực ở API v1

Thứ này tốn nhiều giờ nếu không biết trước:

| Endpoint v1 | `Authorization: Bearer` | `x-api-key` |
|---|---|---|
| `/v1/models` | 200 | 200 |
| `/v1/chat/completions` | **401 `INVALID_API_KEY`** | đi tiếp bình thường |

Cùng một key, cùng lúc. Endpoint chat **từ chối `Bearer`** và **báo sai lý do** — nói key hỏng trong khi thật ra nó không đọc header đó. Trớ trêu là chính thông báo lỗi của `/v1/models` lại quảng cáo cả hai dạng đều được.

**Kết luận: v1 luôn dùng `x-api-key`; v2 luôn dùng `Bearer pat-`.**

### Model phải được subscribe vào key

Sau khi nạp tiền, lỗi chuyển từ `INSUFFICIENT_BALANCE` sang:

```json
{"error":{"code":"FORBIDDEN",
  "message":"Please subscribe to model in the API Key: claude-sonnet-5",
  "type":"permission_error"}}
```

Giống hệt với `auto`, `gpt-4o-mini`, `claude-sonnet-5`, `gemini-2.5-flash`. Đây cũng là lý do `/v1/models` trả `{"data":null}` dù đã có tiền: endpoint đó liệt kê **model đã subscribe của key này**, không phải catalog.

Việc subscribe làm được bằng API v2, không cần vào web:

```
POST /api/v2/llm/keys/:id/subscriptions
  { "provider_id": "...", "model_id": "...", "alias": "..." }
```

### API v2 — các route đã xác minh còn sống

Tất cả trả `401 auth/invalid-format` khi không có token, nghĩa là route tồn tại:

| Route | Scope | Dùng để |
|---|---|---|
| `GET /api/v2/account/me` | `account:read` | Thông tin tài khoản + số dư |
| `GET /api/v2/account/balance` | `account:read` | `balance`, `withdrawable_balance`, `used_balance` |
| `GET /api/v2/llm/marketplace/models` | `llm:read` | **Catalog marketplace** |
| `GET /api/v2/llm/keys` | `llm:read` | Danh sách LLM key |
| `POST /api/v2/llm/keys` | `llm:write` | Tạo key, trả `raw_key` `sk-...` |
| `DELETE /api/v2/llm/keys/:id` | `llm:write` | Thu hồi key |
| `GET /api/v2/llm/keys/:id/subscriptions` | `llm:read` | Model đã gắn vào key |
| `POST /api/v2/llm/keys/:id/subscriptions` | `llm:write` | **Subscribe model** |
| `DELETE .../subscriptions/:sub_id` | `llm:write` | Unsubscribe |
| `GET /api/v2/llm/usage` | `llm:read` | Lịch sử dùng, phân trang, lọc theo `days` |
| `GET/POST/DELETE /api/v2/tokens` | `session` | Quản lý PAT (dùng JWT session, không phải PAT) |

Còn có nhóm `wallet` để nạp tiền bằng QR SePay (`POST /api/v2/wallet/topup`, polling `GET /api/v2/wallet/topup/:id`) — ngoài phạm vi v1 của app.

Rate limit: **120 req/phút mỗi token**, vượt thì 429.

Envelope thành công của v2: `{"success":true,"data":...}`. Envelope lỗi: `{"error":{"code","message","hint"}}` — **khác cả v1 lẫn CKey**, nên hàm chuẩn hoá lỗi phải đọc được ba dạng.

### Sửa lại kết luận trước

Vòng trước mình viết "không lấy được catalog Vilao qua API, phải scrape web". **Sai.** `GET /api/v2/llm/marketplace/models` làm đúng việc đó. Kết luận cũ đến từ chỗ chỉ dò `api.vilao.ai` mà không biết có `vilao.ai/api/v2`.

### Còn chờ

**Một PAT.** Tạo ở `https://vilao.ai/console/user/api-tokens`. Mỗi user chỉ có một token, full quyền, chỉ hiện một lần lúc tạo.

Có PAT thì làm được hết bằng script, không cần bấm web:
1. `GET /api/v2/llm/marketplace/models` → catalog thật, biết schema và giá
2. `GET /api/v2/llm/keys` → lấy `id` của key `sk-...` hiện có
3. `POST /api/v2/llm/keys/:id/subscriptions` → subscribe một model rẻ
4. Gọi `api.vilao.ai/v1/chat/completions` với `x-api-key` → xong M0 phía Vilao
5. `GET /api/v2/account/balance` trước và sau → **chốt bội số giá bằng cách đối chiếu số dư**

Bước 5 là cách sạch nhất để trả lời câu "VND trên bao nhiêu token", vì Vilao có endpoint số dư còn CKey thì không.

---

## CKey — key không hợp lệ (đã loại trừ nguyên nhân mạng)

Egress tới `api.xah.io` đã mở. Test trên **cả hai host**, cả hai dạng key:

| Host | Key thô | `sk-` + key |
|---|---|---|
| `ckey.vn/v1` | 401 invalid | 401 invalid |
| `api.xah.io/v1` | 401 invalid | 401 invalid |

```json
{"error":{"message":"The API key is invalid.",
  "request_id":"req_fd5b0187f920230924cd5443",
  "type":"authentication_error"}}
```

Trước đây chưa phân biệt được "key sai" với "gọi nhầm host". **Giờ đã rõ: không phải host.**

Bằng chứng phụ cho thấy key *có* được đọc: đổi tên header làm thông báo lỗi đổi theo.

| Header | Thông báo |
|---|---|
| `Authorization: Bearer <k>` | "The API key is invalid." |
| `x-api-key: <k>` | "The API key is invalid." |
| `api-key: <k>` | "A valid API key is required." |
| `Authorization: <k>` (thiếu Bearer) | "A valid API key is required." |

"Invalid" = tìm thấy key rồi tra cứu và loại. "Required" = không tìm thấy key nào. Vậy header đúng, chuỗi key mới sai.

**Cần: copy lại key từ dashboard CKey.** Chuỗi đã thử là 48 ký tự hex không tiền tố; docs của họ dùng dạng `sk-...`.

### Hai host, cùng một backend

`ckey.vn/v1` và `api.xah.io/v1` trả **đúng cùng 498 model, danh sách trùng khít**. Để `api.xah.io` làm mặc định vì đó là base URL chính thức, cho đổi ở Settings.

---

## Ba envelope lỗi khác nhau

```
CKey       : {"error":{"message", "request_id", "type"}}
Vilao v1   : {"error":{"code",    "message",    "type"}}
Vilao v2   : {"error":{"code",    "message",    "hint"|"suggestion"}}
```

`provider.ts` cần hàm chuẩn hoá đọc được cả ba.

## Catalog thay đổi liên tục

Đo thật, hai snapshot CKey cách nhau khoảng một giờ: vẫn 498 model, nhưng `tdsang1999/gemini-3.7-flash` biến mất và `tdsang1999/gemini-3.7-flash-high` xuất hiện.

Người bán đổi listing trong vòng vài giờ. Khi sync **không xoá cứng** listing cũ — đánh dấu `stale` để lịch sử `run` và số liệu tin cậy không mồ côi.

---

## Việc còn lại của M0

1. **Vilao** — tạo PAT ở `/console/user/api-tokens`, rồi mình chạy trọn bộ 5 bước ở trên bằng script
2. **CKey** — copy lại API key cho đúng

## Bảo mật

Các key đã dán vào khung chat nằm trong transcript session này. Mình **không** ghi xuống đĩa và **không** commit (đã grep toàn repo). Vẫn nên **thu hồi và tạo lại** sau khi xong. PAT của Vilao là **full quyền, gồm cả ví tiền** — cẩn thận hơn nữa với nó; từ giờ truyền qua biến môi trường thay vì dán vào chat.
