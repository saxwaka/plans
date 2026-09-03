# M0 — Kết quả khảo sát API (2026-09-03)

Khảo sát thật bằng curl, không đoán. Vilao còn dở vì chưa có key.

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

## Vilao — chặn ở chỗ cần key

| Hạng mục | Kết quả |
|---|---|
| Base URL | `https://api.vilao.ai/v1` — xác nhận qua 401 có cấu trúc |
| Xác thực | `Authorization: Bearer sk-xxx` **hoặc** `x-api-key: sk-xxx` |
| `/v1/models` | 401 `MISSING_AUTH` — bắt buộc có key, không public như CKey |
| `/v1/chat/completions` | 404 khi GET — nhiều khả năng route chỉ nhận POST |
| OpenAPI spec | Không có (`/openapi.json`, `/swagger.json` đều trả về SPA shell) |
| `api.vilao.ai/docs` | SPA tiêu đề "LLM Monitor", nội dung render bằng JS |
| Dữ liệu public | **Không có.** `vilao.ai` là Next.js client-render toàn bộ; `/models`, `/pricing`, `/api/models` đều trả HTML rỗng, không nhúng dữ liệu |

Body lỗi nguyên văn:

```json
{"error":{"code":"MISSING_AUTH",
  "message":"Missing authentication. Provide 'Authorization: Bearer sk-xxx' or 'x-api-key: sk-xxx'.",
  "type":"authentication_error"}}
```

**Cần một key Vilao để đi tiếp.** Với key, chạy:

```bash
VILAO_KEY=sk-xxx VILAO_BASE=https://api.vilao.ai/v1 ./scripts/discover.sh
```

Câu cần trả lời: object model có `pricing` không, đơn vị là VND hay USD, có phải cũng là marketplace nhiều người bán không, và có model ảnh/video không.

---

## Việc còn lại của M0

1. Key Vilao → chạy `scripts/discover.sh`
2. Chốt bội số giá của CKey bằng một request thật + đối chiếu số dư
3. Thử một model Veo xem gọi bằng endpoint nào, trả về dạng gì
4. Xem `ckey.vn/leaderboard` có phải xếp hạng độ tin cậy người bán không
5. Xin mở egress cho `api.xah.io` (base URL chính thức của CKey)
