# Kế hoạch: Web gom API model từ Vilao & CKey

Ngày: 2026-09-03 · Trạng thái: draft v3, đã khảo sát thật (xem `docs/api-notes.md`)

## 1. Hai nguồn

| | CKey | Vilao |
|---|---|---|
| Web | ckey.vn/llm-api | vilao.ai |
| Base URL | `https://api.xah.io/v1` (chính thức) hoặc `https://ckey.vn/v1` | `https://api.vilao.ai/v1` |
| Auth | `Authorization: Bearer sk-xxx` | `Authorization: Bearer` hoặc `x-api-key` |
| `/v1/models` | **Public, không cần key** — 498 model | 401, bắt buộc key |
| Giao thức | OpenAI + Anthropic + Gemini + Ollama | OpenAI (chưa xác nhận thêm) |
| Tiền tệ | VND | chưa biết |
| Khảo sát | **Xong** | **Chặn — cần key** |

## 2. Ba điều khảo sát làm đổi kế hoạch

**a. Có model video thật.** Plan v2 kết luận đây là dịch vụ text thuần — sai. CKey có `Veo-3.1-Lite/Fast/Quality` (240 / 300 / 1200 VND mỗi request), `gpt-image-2`, `FLUX-2-max`, `Qwen-Image`, `z-image-turbo`, và các route `/v1/videos/generations`, `/v1/images/generations`, `/v1/audio/speech` đều tồn tại. Ý định ban đầu của bạn — kéo model video về dùng — làm được.

**b. CKey là marketplace 69 người bán, không phải một nhà cung cấp.** 467/498 id có dạng `nguoiban/ten-model`. Cùng `claude-opus-5` có 16 người bán, giá input từ 390 tới 5000 VND. 47 model có từ 2 người bán trở lên, **trung vị chênh 4.7 lần**. `gpt-image-2` giống hệt nhau: người này 960 VND, người kia 1600 VND.

Nghĩa là chuyện so giá không phải "CKey với Vilao" như plan cũ nghĩ. Nó chủ yếu là **so giá bên trong CKey**, giữa những người bán cùng một model. Vilao chỉ là nguồn thứ hai cộng thêm.

**c. Rẻ nhất thường là bẫy.** Vài listing để giá 1 VND (`gemini-3.1-pro` chênh tới 6923 lần) — gần như chắc chắn là listing hỏng hoặc mồi câu. Nên chỉ số giá đứng một mình là vô dụng. Cần đo **độ tin cậy thật** của từng người bán: gọi được không, lỗi bao nhiêu phần trăm, chậm bao nhiêu.

Đây mới là chỗ đáng build, và không có công cụ nào sẵn làm việc này.

## 3. Sản phẩm

Web chạy local, làm ba việc mà Open WebUI / LibreChat không làm:

1. **Catalog gộp** — tất cả model của CKey (498) và Vilao, gom các listing cùng một model về một dòng, xoè ra thấy từng người bán
2. **Bảng xếp hạng người bán** — cho mỗi model, sắp theo *giá đã hiệu chỉnh theo độ tin cậy*, không phải giá trần trụi. Người bán 1 VND mà 90% request lỗi phải xếp dưới người bán 400 VND chạy ổn
3. **Định tuyến + đo đạc** — gọi qua người bán tốt nhất, tự dò xuống người kế tiếp khi lỗi, và mỗi lần gọi lại cập nhật số liệu tin cậy

Cộng thêm: playground gõ prompt, trang sinh ảnh/video, và theo dõi chi tiêu theo ngày.

Vòng lặp cốt lõi: **mỗi request thật vừa là việc bạn cần làm, vừa là một phép đo làm bảng xếp hạng chính xác hơn.**

## 4. Kiến trúc

Next.js (App Router) + TypeScript + SQLite. Một process vừa serve UI vừa có API route — key chỉ sống ở server.

```
app/
  page.tsx          → Catalog: model gộp, xoè ra danh sách người bán
  model/[id]/       → chi tiết: mọi người bán, giá, độ tin cậy, lịch sử
  playground/       → chat, chọn model, có nút "để hệ thống chọn người bán"
  media/            → sinh ảnh / video (Veo, FLUX, gpt-image)
  usage/            → chi tiêu theo ngày / model / người bán
  settings/         → base URL + key mỗi provider, nút test
  api/
    chat/           → proxy streaming; NƠI DUY NHẤT chạm key
    media/
    models/sync/
lib/
  provider.ts       → OpenAICompatibleProvider(baseUrl, apiKey) — dùng chung cả 2
  catalog.ts        → chuẩn hoá id 'nguoiban/model' → (seller, base_model)
  pricing.ts        → tính tiền: token / per_request / min_charge
  routing.ts        → chọn người bán, fallback khi lỗi
  db/
```

Vì cả hai cùng chuẩn OpenAI, `provider.ts` là file duy nhất gọi HTTP. Không cần adapter riêng cho từng bên.

## 5. Data model

- `provider(id, name, base_url, api_key, enabled)`
- `listing(id, provider_id, external_id, seller, base_model, kind, price_json, context, raw_json, synced_at)`
- `run(id, listing_id, kind, tokens_in, tokens_out, cost_vnd, latency_ms, status, error, created_at)`
- `seller_stat(listing_id, calls, failures, p50_latency, last_ok_at, last_error)` — dẫn xuất từ `run`

`base_model` là khoá gom nhóm: `dungcsnd113/claude-opus-5` và `claude-opus-5` cùng về `claude-opus-5`. Chuẩn hoá phải bỏ qua hoa thường — dữ liệu thật có cả `GPT-5.6-sol` lẫn `gpt-5.6-sol`.

`pricing.ts` phải xử lý ba chế độ, không được giả định chỉ có token:

- theo token: `input` × tokens_in + `output` × tokens_out
- phẳng: `per_request`
- sàn: `min_charge_per_request` — 127 model **chỉ** có `per_request`, phần lớn là ảnh/video

`input` với `prompt` là hai tên của cùng một giá trị (kiểm tra 498 model, không cái nào lệch); `output` với `completion` cũng vậy. Đọc một, bỏ cái kia.

## 6. Các mốc

| Mốc | Nội dung | Xong khi |
|---|---|---|
| ~~M0~~ | ~~Khảo sát API~~ | **CKey xong. Vilao chờ key** |
| **M1** Khung + Settings | Next.js + SQLite + Settings; đồng thời chốt bội số giá bằng 1 request thật | Test connection 2 bên OK; biết chắc giá là VND trên 1M token hay khác |
| **M2** Catalog | Sync `/v1/models`, gom theo `base_model`, xoè người bán | Gõ "opus", thấy 1 dòng với 16 người bán bên dưới, sắp theo giá |
| **M3** Playground | `/v1/chat/completions` streaming qua API route, ghi `run` | Gõ prompt ra chữ chạy; mỗi lần gọi ghi lại tiền + độ trễ |
| **M4** Xếp hạng + định tuyến | `seller_stat`, điểm tin cậy, tự chọn + fallback | Người bán 1 VND hay lỗi bị đẩy xuống dưới; gọi hỏng thì tự sang người kế |
| **M5** Ảnh & video | `/v1/images/generations`, `/v1/videos/generations`, lưu file về `storage/` | Sinh 1 clip Veo-3.1, file nằm trên máy |
| **M6** Chi tiêu | Trang Usage, tổng theo ngày/model/người bán, cảnh báo ngưỡng | Biết tuần này tiêu bao nhiêu, cho ai |

M2 là mốc có giá trị đầu tiên — chỉ cần nó là đã trả lời được "model này nên mua của ai". M4 là chỗ khó và đáng nhất.

## 7. Rủi ro

| Rủi ro | Xử lý |
|---|---|
| Người bán rẻ bất thường là listing hỏng | Đây là lý do M4 tồn tại. Không bao giờ sắp xếp chỉ theo giá; người bán chưa có số liệu thì đánh dấu "chưa kiểm chứng" thay vì xếp đầu |
| Rò rỉ API key | Key chỉ ở server route + SQLite; `.env*`, `*.db`, `storage/` đã trong `.gitignore` |
| Người bán biến mất / đổi giá | Sync định kỳ; giữ listing cũ, đánh dấu `stale` thay vì xoá, để lịch sử `run` không mồ côi |
| Đốt tiền khi thăm dò độ tin cậy | Không gọi thử tự động. Chỉ tính điểm từ request bạn thật sự dùng |
| `api.xah.io` bị chặn egress | Dùng `ckey.vn/v1`; cho đổi base URL ở Settings |
| Vilao có thể không giống CKey | `provider.ts` chỉ giả định chuẩn OpenAI. Nếu Vilao không phải marketplace, `seller` để rỗng và mọi thứ khác vẫn chạy |

## 8. Ngoài phạm vi v1

Đăng nhập / nhiều người dùng · deploy public · tự host model · mobile app · giao thức Anthropic và Gemini của CKey (chỉ dùng OpenAI cho v1)

## 9. Bước kế tiếp

1. **Một key Vilao** → chạy `./scripts/discover.sh` để xong nốt M0
2. Xin mở egress cho `api.xah.io` nếu muốn dùng base URL chính thức của CKey
3. Xác nhận: bắt đầu code M1?
