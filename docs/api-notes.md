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

## Vilao — key hợp lệ, nhưng tài khoản hết tiền

Đã thử với key thật (2026-09-03).

### Key có thật

Phép thử đối chứng: gọi `/v1/models` bằng một key bịa ra trả về `401 INVALID_API_KEY`; bằng key thật trả về `200`. Vậy key được server nhận.

### Bẫy xác thực — hai endpoint không giống nhau

Đây là thứ tốn nhiều giờ nếu không biết trước:

| Endpoint | `Authorization: Bearer` | `x-api-key` |
|---|---|---|
| `/v1/models` | 200 | 200 |
| `/v1/chat/completions` | **401 `INVALID_API_KEY`** | 402 `INSUFFICIENT_BALANCE` |

Cùng một key, cùng lúc. Endpoint chat **từ chối `Bearer`** và báo sai lý do — nói key hỏng trong khi thật ra nó chỉ không đọc header đó. Trớ trêu là chính thông báo lỗi của `/v1/models` lại quảng cáo cả hai dạng đều được.

**Kết luận: dùng `x-api-key` cho Vilao, đừng dùng `Bearer`.**

### Tài khoản chưa nạp tiền

```json
{"error":{"code":"INSUFFICIENT_BALANCE",
  "message":"Insufficient balance to complete the request.",
  "type":"insufficient_quota"}}
```

Đây gần như chắc chắn cũng là lý do `/v1/models` trả `{"data":null,"object":"list"}` — chưa có tiền thì chưa có model nào gắn vào key. Trang chủ Vilao nói người dùng *chọn model trên Marketplace*, nên danh sách model là **theo từng key**, không phải catalog chung như CKey.

Chưa trả lời được, phải nạp tiền rồi chọn model mới biết: schema object model ra sao, có kèm giá không, đơn vị VND hay USD, có phải marketplace nhiều người bán không, có model ảnh/video không.

### Bề mặt API rất hẹp

Chỉ có hai route. Tất cả những cái sau đều `404 {"error":"not found","path":...}`:

```
/v1/me  /v1/user  /v1/account  /v1/balance  /v1/credits
/v1/usage  /v1/key  /v1/marketplace  /v1/catalog  /v1/models/list
```

Không có endpoint xem số dư. Muốn hiện số dư trong app thì phải scrape web, hoặc bỏ tính năng đó.

---

## CKey — key chưa dùng được từ đây

Key bạn gửi bị `ckey.vn/v1/chat/completions` từ chối, thử cả hai dạng có và không có tiền tố `sk-`:

```json
{"error":{"message":"The API key is invalid.",
  "request_id":"req_bd1988402061eef07b47b350",
  "type":"authentication_error"}}
```

Hai khả năng, chưa phân biệt được:

1. Key chỉ hợp lệ với **base URL chính thức `api.xah.io`**, còn `ckey.vn/v1` là mirror chỉ phục vụ `/v1/models` công khai. `api.xah.io` **vẫn bị chặn egress** (403 ở CONNECT), nên không kiểm chứng được từ đây.
2. Key sai hoặc đã hết hạn.

Cách phân biệt: chạy trên máy bạn
```bash
curl https://api.xah.io/v1/chat/completions   -H "Authorization: Bearer sk-YOUR_KEY" -H 'Content-Type: application/json'   -d '{"model":"dungcsnd113/claude-opus-5","max_tokens":16,
       "messages":[{"role":"user","content":"Say OK"}]}'
```
Nếu chạy được thì là khả năng 1, và app phải trỏ vào `api.xah.io`.

Lưu ý: `ckey.vn/v1/models` trả 497–498 model **bất kể có key hay không, key đúng hay sai** — endpoint này không kiểm tra xác thực. Đừng dùng nó để test key.

### Envelope lỗi hai bên khác nhau

```
CKey  : {"error":{"message", "request_id", "type"}}
Vilao : {"error":{"code",    "message",    "type"}}
```

CKey có `request_id` (hữu ích khi báo lỗi cho người bán), Vilao có `code` máy đọc được. `pricing.ts`/`provider.ts` cần hàm chuẩn hoá lỗi đọc được cả hai.

### Catalog thay đổi liên tục

Đo thật, hai snapshot cách nhau khoảng một giờ: vẫn 498 model, nhưng `tdsang1999/gemini-3.7-flash` biến mất và `tdsang1999/gemini-3.7-flash-high` xuất hiện.

Người bán đổi listing trong vòng vài giờ. Vì vậy khi sync **không được xoá cứng** listing cũ — đánh dấu `stale` để lịch sử `run` và số liệu tin cậy không bị mồ côi.

---

## Việc còn lại của M0

1. **Nạp tiền Vilao**, chọn vài model trên Marketplace → chạy lại `/v1/models` để lấy schema thật
2. **Kiểm chứng key CKey** với `api.xah.io` bằng lệnh curl ở trên (chạy trên máy bạn)
3. Xin mở egress cho `api.xah.io`
4. Chốt bội số giá CKey bằng một request thật + đối chiếu số dư — **vẫn chưa làm được**, cả hai key đều chưa gọi thành công
5. Thử một model Veo xem gọi bằng endpoint nào, trả về link hay base64
6. Xem `ckey.vn/leaderboard` có phải xếp hạng độ tin cậy người bán không

## Bảo mật

Hai key được dán thẳng vào khung chat, nên chúng nằm trong transcript của session này. Mình **không** ghi chúng xuống đĩa và **không** commit (đã kiểm tra bằng grep toàn repo). Dù vậy nên **thu hồi và tạo key mới** sau khi khảo sát xong; từ giờ truyền key qua biến môi trường thay vì dán vào chat.
