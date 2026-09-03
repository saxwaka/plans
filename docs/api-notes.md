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

## Vilao — cần "subscribe" từng model vào key

Đã thử với key thật, sau khi tài khoản có số dư (2026-09-03).

### Key hợp lệ

Phép thử đối chứng: `/v1/models` với key bịa ra trả `401 INVALID_API_KEY`; với key thật trả `200`.

### Bẫy xác thực — hai endpoint không giống nhau

Thứ này tốn nhiều giờ nếu không biết trước:

| Endpoint | `Authorization: Bearer` | `x-api-key` |
|---|---|---|
| `/v1/models` | 200 | 200 |
| `/v1/chat/completions` | **401 `INVALID_API_KEY`** | đi tiếp bình thường |

Cùng một key, cùng lúc. Endpoint chat **từ chối `Bearer`** và **báo sai lý do** — nói key hỏng trong khi thật ra nó không đọc header đó. Trớ trêu là chính thông báo lỗi của `/v1/models` lại quảng cáo cả hai dạng đều được.

**Kết luận: Vilao luôn dùng `x-api-key`.**

### Model phải được gắn vào key trước khi gọi

Sau khi nạp tiền, lỗi chuyển từ `INSUFFICIENT_BALANCE` sang:

```json
{"error":{"code":"FORBIDDEN",
  "message":"Please subscribe to model in the API Key: claude-sonnet-5",
  "type":"permission_error"}}
```

Giống hệt nhau với `auto`, `gpt-4o-mini`, `claude-sonnet-5`, `gemini-2.5-flash`.

Đây là mô hình khác hẳn CKey. Vilao **không** bán catalog chung — bạn phải vào Marketplace **đăng ký từng model vào từng API key**. Vì thế `/v1/models` vẫn trả `{"data":null}` dù đã có tiền: endpoint đó liệt kê **model đã đăng ký của key này**, không phải catalog.

Hệ quả cho app: `/v1/models` của Vilao là *quyền của key*, không phải danh mục để duyệt. Muốn có catalog Vilao để so giá thì phải scrape web — API không cung cấp.

### Bề mặt API rất hẹp

Chỉ hai route. Tất cả những cái sau đều `404 {"error":"not found","path":...}`:

```
/v1/me  /v1/user  /v1/account  /v1/balance  /v1/credits
/v1/usage  /v1/key  /v1/marketplace  /v1/catalog  /v1/models/list
```

Không có endpoint xem số dư.

### Còn chờ

Đăng ký vài model vào key trên Marketplace → gọi lại để lấy schema `/v1/models` thật, biết đơn vị giá, và xem có model ảnh/video không.

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

Trước đây chưa phân biệt được "key sai" với "gọi nhầm host". **Giờ đã rõ: không phải host.** Host chính thức cũng từ chối, nên key sai, hết hạn, hoặc copy thiếu.

Bằng chứng phụ cho thấy key *có* được đọc: đổi tên header làm thông báo lỗi đổi theo.

| Header | Thông báo |
|---|---|
| `Authorization: Bearer <k>` | "The API key is invalid." |
| `x-api-key: <k>` | "The API key is invalid." |
| `api-key: <k>` | "A valid API key is required." |
| `Authorization: <k>` (thiếu Bearer) | "A valid API key is required." |

"Invalid" nghĩa là đã tìm thấy key và tra cứu rồi loại; "required" nghĩa là không tìm thấy key ở đâu cả. Vậy `Bearer` và `x-api-key` đều là header đúng, và chuỗi key mới là thứ sai.

**Cần: copy lại key từ dashboard CKey.** Key mẫu trong docs của họ có dạng `sk-...`; chuỗi đã thử là 48 ký tự hex không tiền tố.

### Hai host, cùng một backend

`ckey.vn/v1` và `api.xah.io/v1` trả **đúng cùng 498 model, danh sách trùng khít**. Dùng host nào cũng được; để `api.xah.io` làm mặc định vì đó là base URL chính thức, và cho đổi ở Settings.

### Envelope lỗi hai bên khác nhau

```
CKey  : {"error":{"message", "request_id", "type"}}
Vilao : {"error":{"code",    "message",    "type"}}
```

CKey có `request_id` (hữu ích khi khiếu nại người bán), Vilao có `code` máy đọc được. Cần hàm chuẩn hoá lỗi đọc được cả hai.

### Catalog thay đổi liên tục

Đo thật, hai snapshot cách nhau khoảng một giờ: vẫn 498 model, nhưng `tdsang1999/gemini-3.7-flash` biến mất và `tdsang1999/gemini-3.7-flash-high` xuất hiện.

Người bán đổi listing trong vòng vài giờ. Khi sync **không xoá cứng** listing cũ — đánh dấu `stale` để lịch sử `run` và số liệu tin cậy không mồ côi.

---

## Việc còn lại của M0

Cả hai đều là thao tác trên dashboard, không phải việc code:

1. **CKey** — copy lại API key cho đúng
2. **Vilao** — vào Marketplace đăng ký vài model vào key

Sau đó mới chốt được: bội số giá (VND trên 1 triệu token hay khác — xác nhận bằng một request thật rồi đối chiếu số dư), schema model của Vilao, và cách gọi model video Veo.

## Bảo mật

Hai key được dán thẳng vào khung chat nên nằm trong transcript session này. Mình **không** ghi chúng xuống đĩa và **không** commit (đã grep toàn repo). Vẫn nên **thu hồi và tạo key mới** sau khi xong; từ giờ truyền qua biến môi trường thay vì dán vào chat.
