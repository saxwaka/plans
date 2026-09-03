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

## Vilao — khảo sát XONG

### Hai API riêng biệt

Vòng dò đầu chỉ soi `api.vilao.ai` nên bỏ sót hẳn một nửa.

| | API suy luận (v1) | API quản lý (v2) |
|---|---|---|
| Host | `https://api.vilao.ai/v1` | `https://vilao.ai/api/v2` |
| Token | LLM key `sk-...` | PAT `pat-...` |
| Header | **`x-api-key`** | **`Authorization: Bearer`** |

Hai loại token không thay nhau được. PAT lấy ở `/console/user/api-tokens`, mỗi user một cái, full quyền (gồm cả ví tiền).

### Bẫy xác thực ở v1

| Endpoint v1 | `Authorization: Bearer` | `x-api-key` |
|---|---|---|
| `/v1/models` | 200 | 200 |
| `/v1/chat/completions` | **401 `INVALID_API_KEY`** | chạy bình thường |

Endpoint chat từ chối `Bearer` và **báo sai lý do** — nói key hỏng trong khi thật ra nó không đọc header đó. Trớ trêu là chính thông báo lỗi của `/v1/models` lại quảng cáo cả hai dạng đều được. **v1 luôn dùng `x-api-key`.**

### Model phải subscribe vào key trước

`/v1/models` liệt kê **model đã subscribe của key này**, không phải catalog — nên nó trả `{"data":null}` với key mới. Gọi model chưa subscribe:

```json
{"error":{"code":"FORBIDDEN","message":"Please subscribe to model in the API Key: claude-sonnet-5","type":"permission_error"}}
```

Subscribe bằng API, không cần vào web:

```
POST /api/v2/llm/keys/:key_id/subscriptions
  {"provider_id":"<uuid>", "model_id":"minimax-m2.7", "alias":"cheap"}
```

Đã chạy thật, trả về bản ghi subscription đầy đủ kèm giá đã chốt tại thời điểm subscribe.

### ĐÃ CHỐT: giá là VND trên 1 TRIỆU token

Đây là câu treo lâu nhất, giờ có bằng chứng chặt.

Gọi thật `minimax-m2.7` (rouyea, `input=50`, `output=100`, `min_price_per_request=4`):

```
prompt_tokens 914 · completion_tokens 104
số dư: 10000 -> 9996   (trừ đúng 4 VND)
```

Bản ghi `/api/v2/llm/usage` cho:

```json
{"input_tokens":914, "output_tokens":104,
 "input_cost":3.258467023172906, "output_cost":0.7415329768270945, "total_cost":4}
```

Hai cách suy ra cùng một kết luận:

1. **Loại trừ.** Nếu giá tính trên 1K token thì request này tốn `914/1000×50 + 104/1000×100 = 56.1 VND`, phải trừ 56. Thực tế trừ 4. Loại.
2. **Khớp tỷ lệ.** Giá thô theo 1M token là `0.0457` và `0.0104` VND, tỷ lệ **81.5% / 18.5%**. Trong bản ghi, `3.2585/4 = 81.5%` và `0.7415/4 = 18.5%` — **trùng khít**. Vậy Vilao tính giá thô theo 1M token rồi **giãn tỷ lệ lên mức sàn** `min_price_per_request`.

Cách 2 là bằng chứng trực tiếp, không chỉ là loại trừ. CKey dùng cùng thang giá (cùng độ lớn cho cùng model), nên nhiều khả năng cũng là VND/1M — nhưng **chưa kiểm chứng được** vì CKey không có endpoint số dư.

**Hệ quả cho `pricing.ts`:** đừng chỉ nhân token với giá. Công thức thật là
`max(min_price_per_request, input_tokens/1e6 × price_in + output_tokens/1e6 × price_out)`.
Với request nhỏ thì **mức sàn quyết định**, không phải token. 127 model của CKey và 247 của Vilao còn không có giá token nào cả — chỉ `per_request`.

### Cảnh báo: prompt bị phồng to

Prompt gửi đi khoảng 15 token, nhưng `prompt_tokens` báo về **914**, trong đó **891 là `cached_tokens`**. Có một system prompt lớn được chèn vào phía sau. Nên ước tính chi phí **không được** dựa trên độ dài prompt của người dùng — phải dựa trên `usage` trả về.

Ngoài ra `usage.cost` trong response OpenAI luôn bằng **0**, không dùng được. Tiền thật nằm ở `/api/v2/llm/usage` (`total_cost`) hoặc suy ra từ chênh lệch số dư.

Độ trễ thực đo: **40 giây** cho một request 104 token output.

### PHÁT HIỆN LỚN NHẤT: Vilao đã công bố sẵn số liệu độ tin cậy

`GET /api/v2/llm/marketplace/models` trả **604 listing, 64 người bán**, và mỗi listing kèm sẵn:

```
success_rate · total_requests · success_count · failed_count
avg_latency_ms · avg_tps · health_check_latency_ms · health_check_tps
avg_rating · rating_count · provider_verified · is_recommended
last_test_score · last_test_at · last_test_status
```

**515/604 listing có số liệu thật.** Listing lớn nhất (`claude-opus-4-8` của Vilao Official) dựa trên **849.389 request**.

Đây đúng là thứ M4 định tự xây từ traffic của mình. Không thể nào đo lại được quy mô đó bằng một người dùng. **M4 phải viết lại:** với Vilao thì *dùng số liệu họ công bố*; với CKey — nơi không công bố gì — thì tự đo mới là nguồn duy nhất. Thành ra là mô hình lai.

Phân trang: `?page=N&page_size=100`, đọc `total_count`. Rate limit **120 req/phút** mỗi token.

### Chênh giá còn dữ hơn CKey

Trung vị **14.6x** trên 40 model có nhiều người bán (CKey là 4.7x). Ví dụ `claude-opus-4-8`, 12 người bán:

```
rouyea        in=  300  out= 1300   success= 99.0%  reqs= 11967
vilao         in= 7500  out=37500   success= 99.2%  reqs=849389   verified
duc-gpt-5-5   in=15000  out=75000   success= 84.3%  reqs=  1963
vilao         in=125000 out=625000  success= 96.5%  reqs= 14604
```

rouyea rẻ hơn Vilao Official **25 lần** với tỷ lệ thành công gần như bằng nhau, trên gần 12.000 request — đủ mẫu để tin.

Nhưng cũng chính `rouyea` có listing khác `in=1500` với **success 0.0% trên đúng 1 request**. Cùng người bán, listing khác nhau, chất lượng khác hẳn. Và nhiều listing có `reqs=0`, `success_rate=null` — chưa kiểm chứng, không phải "tốt".

**Xếp hạng phải theo từng listing, không theo người bán, và phải phân biệt "chưa có dữ liệu" với "đã chứng minh là tốt".**

### Model video/ảnh trên Vilao

| Model | Người bán | Giá | Thành công |
|---|---|---|---|
| `veo-3.1-lite` | wowz | 200 VND/request | **66.2%** |
| `veo-3.1-fast` | wowz | 250 VND/request | **71.4%** |
| `veo-3.1-quality` | wowz | 1000 VND/request | **54.6%** |
| `wan-t2v` | alicloud | 500 VND/1M token | 79.6% |
| `wan2.7-i2v` | alicloud | 700 VND/1M token | 85.8% |

Phân loại `type`: 542 text, 37 image, 8 embedding, 6 transcribe, **5 video**, 3 tts.

**Tỷ lệ thành công của model video thấp đáng lo — 55% đến 86%.** Veo Quality hỏng gần một nửa số lần gọi, mà vẫn là loại đắt nhất. Ai định dùng video nghiêm túc cần biết điều này trước: phải có retry, và phải tính chi phí theo *số lần gọi*, không phải số clip nhận được.

**So chéo hai sàn:** cùng người bán `wowz` bán Veo trên cả hai, Vilao rẻ hơn.

| | Vilao (wowz) | CKey (wowztools) |
|---|---|---|
| Veo-3.1-Lite | 200 | 240 |
| Veo-3.1-Fast | 250 | 300 |
| Veo-3.1-Quality | 1000 | 1200 |

CKey đắt hơn đều **20%**. Đây chính là kiểu so sánh mà app cần làm tự động.

### Trường dữ liệu hữu ích khác

`GET /api/v2/llm/keys` trả về mỗi key kèm `rate_limit_rpm`, `total_requests`, `total_spent`, `daily_budget`, `monthly_budget`, `active`, `expires_at`, `favorite`. Có sẵn hạn mức ngân sách theo ngày/tháng — không cần tự làm cảnh báo chi tiêu.

`GET /api/v2/llm/usage` mỗi bản ghi có `input_cost`, `output_cost`, `total_cost`, `latency_ms`, `success`, `actual_model`, `provider_id`, `stream`, `request_type`. Đây là nguồn chuẩn cho trang Usage — không cần tự ghi lại.

---

## CKey — khảo sát XONG

Key mới (dạng `sk-...`) chạy được. Key cũ 48 ký tự hex không tiền tố đúng là sai, không phải lỗi host.

### Base URL

`https://api.xah.io/v1` (chính thức) và `https://ckey.vn/v1` trả cùng một catalog 498 model, danh sách trùng khít. Auth: `Authorization: Bearer sk-...`.

### Response kèm sẵn chi phí — tiện hơn Vilao

```json
"usage": {"prompt_tokens":24, "completion_tokens":60, "total_tokens":84,
          "x_ckey": {"cost": 23.4, "request_id": "req_33b1c9a77873244f92b6bdea"}}
```

`usage.x_ckey.cost` là tiền thật của request, ngay trong response. Vilao thì `usage.cost` **luôn bằng 0**, phải gọi thêm `/api/v2/llm/usage`. Với CKey không cần gọi thêm gì.

### ĐÃ CHỐT: cũng là VND trên 1 TRIỆU token

Gọi thật `dungcsnd113/claude-opus-5`, giá listing lúc gọi:

```json
{"input":390, "output":780, "per_request":11.7, "min_charge_per_request":23.4, "unit":"VND"}
```

Kết quả: `prompt_tokens 24`, `completion_tokens 60`, **cost 23.4** — đúng bằng `min_charge_per_request`.

- Giả thuyết **VND/1M**: token cost = `24/1e6×390 + 60/1e6×780 = 0.056 VND`, dưới sàn 23.4 → tính 23.4. **Khớp.**
- Giả thuyết **VND/1K**: token cost = `24/1000×390 + 60/1000×780 = 56.16 VND`, **vượt** sàn 23.4 → phải tính 56.16. Thực tế tính 23.4. **Loại.**

Cùng logic đã dùng cho Vilao, và ra cùng kết luận. **Hai sàn dùng chung một thang giá: VND trên 1 triệu token.**

Còn một chi tiết chưa tách được: `per_request` (11.7) và `min_charge_per_request` (23.4) là hai trường riêng, chưa rõ `per_request` có cộng thêm vào giá token hay không — vì với listing này, sàn luôn thắng ở mọi độ dài prompt hợp lý (800 token output cũng chỉ ra 0.62 VND). Không ảnh hưởng thực tế: cứ tính `max(min_charge, per_request + token_cost)` là an toàn.

### Không có endpoint số dư

Mọi path lạ đều bị proxy thẳng lên upstream và trả **503 "The upstream AI gateway is unavailable"**, không phải 404:

```
/v1/dashboard/billing/subscription   503
/v1/credits  /v1/balance  /v1/me     503
```

Lưu ý khi viết code: **503 ở CKey không có nghĩa là sàn đang sập** — rất có thể chỉ là gọi sai đường dẫn. Đừng dùng 503 làm tín hiệu health check.

Theo dõi chi tiêu với CKey phải cộng dồn `x_ckey.cost` từ từng response, vì không có nguồn nào khác.

### Giá listing đổi trong lúc khảo sát

Snapshot lúc đầu: `dungcsnd113/claude-opus-5` có `per_request=11.7`, không có `min_charge_per_request`.
Vài giờ sau: cùng listing đó có thêm `min_charge_per_request: 23.4`.

Người bán đổi giá ngay giữa phiên làm việc. Củng cố kết luận trước: **giá phải được chốt lại tại thời điểm gọi**, và bảng so giá cần hiện thời điểm sync.

---

## Đối chiếu hai sàn

| | CKey | Vilao |
|---|---|---|
| Base URL suy luận | `api.xah.io/v1` | `api.vilao.ai/v1` |
| Header | `Authorization: Bearer` | **`x-api-key`** |
| Catalog | `/v1/models`, **public không cần key** | `/api/v2/llm/marketplace/models`, cần PAT |
| Số listing | 498 | 604 |
| Người bán | 69 | 64 |
| Trung vị chênh giá | 4.7x | **14.6x** |
| Đơn vị giá | VND / 1M token | VND / 1M token |
| Chi phí mỗi request | `usage.x_ckey.cost` trong response | `/api/v2/llm/usage`, `usage.cost` = 0 |
| Số dư | **không có endpoint** | `/api/v2/account/balance` |
| Số liệu tin cậy | **không công bố gì** | `success_rate`, `total_requests`, `avg_latency_ms`, `avg_rating`, `verified` |
| Cần subscribe trước? | Không | **Có**, qua API v2 |
| Ngân sách theo ngày/tháng | không | có sẵn trên mỗi key |

Hai sàn **bổ sung cho nhau chứ không thay thế nhau**: CKey mở catalog cho ai cũng xem được nhưng mù về chất lượng; Vilao bắt xác thực nhưng cho biết cái nào thật sự chạy được.

## Ba envelope lỗi khác nhau

```
CKey       : {"error":{"message", "request_id", "type"}}
Vilao v1   : {"error":{"code",    "message",    "type"}}
Vilao v2   : {"error":{"code",    "message",    "hint"|"suggestion"}}
```

---

## Việc còn lại của M0

Chỉ còn một: **thử một model video** xem gọi bằng endpoint nào (`/v1/chat/completions` hay `/v1/videos/generations`) và trả về link hay base64. Rẻ nhất là `veo-3.1-lite` của Vilao, 200 VND — nhưng tỷ lệ thành công chỉ 66%, nên có thể mất tiền mà không ra clip. Chờ bạn đồng ý.

## Bảo mật

Các key và PAT đã dán vào chat nên nằm trong transcript session này. Mình **không** ghi xuống đĩa và **không** commit (đã grep toàn repo). **PAT Vilao là full quyền gồm cả ví tiền — thu hồi ngay** ở `/console/user/api-tokens` sau khi xong. Từ giờ truyền qua biến môi trường.
