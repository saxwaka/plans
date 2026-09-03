# Kế hoạch: Web gom API model từ Vilao & CKey

Ngày: 2026-09-03 · Trạng thái: draft v2 · chờ mở allowlist để chạy M0

## 1. Hai nguồn là gì

| | Vilao AI | CKEY |
|---|---|---|
| Domain | https://vilao.ai | https://ckey.vn/llm-api |
| Mô tả | "AI Models Marketplace · API Claude, GPT, Gemini giá rẻ tại Việt Nam" | "Cheap LLM API: GPT, Claude, Gemini, OpenAI-ready" |
| Số model | 300+ | 340 |
| Giao thức | OpenAI-compatible | OpenAI-compatible |
| Auth | Bearer API key | Bearer API key |
| Giá | Trả theo token thực dùng, không thuê bao | Trả theo token, giá minh bạch |
| Đặc điểm | Có alias tự động định tuyến model; hỗ trợ streaming + function calling | Truy cập ngay bằng cURL/SDK |

**Hệ quả quan trọng:** cả hai đều nói cùng một ngôn ngữ — OpenAI API. Nghĩa là **không cần viết 2 adapter khác nhau**. Một client OpenAI-compatible duy nhất, chỉ đổi `base_url` + `api_key`, là chạy được cả hai. Đây là điểm đơn giản hoá lớn nhất so với plan v1.

## 2. Phát hiện làm đổi hướng: đây là LLM text, không phải video

Plan v1 (và tên branch `video-model-scraper`) giả định đây là dịch vụ sinh video, cần cơ chế submit job → poll `task_id` → tải file về. **Khảo sát cho thấy không phải vậy.** Cả hai đều tự mô tả là marketplace LLM: GPT, Claude, Gemini, Qwen, DeepSeek — tính năng nổi bật là chat completions, streaming, function calling. Không thấy nhắc tới sinh video.

Hệ quả: **bỏ toàn bộ phần worker/poller/queue**. Request là đồng bộ (hoặc streaming), trả kết quả ngay. Kiến trúc gọn đi đáng kể.

*Mức tin cậy: trung bình.* Đây là đọc từ mô tả trang chủ qua search, chưa gọi API thật (xem mục 3). Nếu bạn thật sự cần sinh **video** thì cần xác nhận lại — có thể 2 site này không phải chỗ để làm việc đó, hoặc có endpoint riêng ngoài chuẩn OpenAI.

## 3. Điểm chặn: chưa khảo sát API được (đã chọn cách A)

Session này chạy trong môi trường remote có network policy chặn egress. Cả `vilao.ai` và `ckey.vn` bị gateway trả 403 ngay ở bước CONNECT — chính sách của tổ chức, không phải lỗi tạm thời, và không được phép route vòng:

```
curl: (56) CONNECT tunnel failed, response 403   (vilao.ai:443, api.vilao.ai:443)
curl: (56) CONNECT tunnel failed, response 403   (ckey.vn:443, api.ckey.vn:443)
```

Đã kiểm tra lại ngày 2026-09-03: vẫn 403.

**Cách A — mở allowlist.** Việc này phải làm từ phía bạn, trong phần cấu hình environment của Claude Code on the web:

1. Vào Settings của environment đang dùng cho repo `saxwaka/plans`
2. Ở mục network / egress allowlist, thêm 4 host:
   `vilao.ai`, `api.vilao.ai`, `ckey.vn`, `api.ckey.vn`
   (thêm cả `api.*` vì base URL của API thường nằm ở subdomain riêng)
3. **Mở session mới** — policy được nạp lúc container khởi tạo, session đang chạy không tự nhận thay đổi
4. Trong session mới, chạy:

```bash
VILAO_KEY=xxx CKEY_KEY=yyy ./scripts/discover.sh
```

Script `scripts/discover.sh` đã có sẵn trong repo. Nó tự dò vài dạng base URL phổ biến, gọi `GET /v1/models` cho từng bên, lưu JSON thô vào `docs/samples/`, rồi in ra: số lượng model, danh sách field của một object model, và một mẫu. Key đọc từ biến môi trường, không ghi xuống đĩa; `docs/samples/*.json` đã nằm trong `.gitignore`.

Bốn câu cần trả lời từ output đó:

1. Base URL chính xác của mỗi bên
2. Object model có kèm **giá** không? (`pricing`, `price`, `input_cost`...)
3. Có kèm **context length** không?
4. Có model **không phải text** không? (image / video / audio trong `id` hoặc `type`)

Câu 2 quyết định M3 (so giá) có làm được tự động hay phải nhập giá tay. Câu 4 chốt dứt điểm nghi vấn ở mục 2.

**Cách B (dự phòng)** — nếu không mở được allowlist: chạy `scripts/discover.sh` trên máy bạn rồi paste output vào chat. Kết quả như nhau, và không phải đưa key cho mình.

## 4. Vậy web này để làm gì

Nếu chỉ để chat thì đã có sẵn công cụ (mục 8). Giá trị thật của việc tự build nằm ở chỗ bạn có **hai nguồn cùng bán những model giống nhau với giá khác nhau**:

1. **Catalog gộp** — một bảng duy nhất, 640 dòng model từ 2 nguồn, tìm/lọc được
2. **So giá** — cùng `claude-opus-4`, Vilao bao nhiêu, CKey bao nhiêu, chênh mấy %
3. **Định tuyến** — chọn model, tự gọi bên rẻ hơn; bên nào lỗi thì fallback sang bên kia
4. **Theo dõi chi tiêu** — mỗi request log lại token + tiền, tổng theo ngày/model/provider
5. **Playground** — chỗ gõ prompt, chạy thử, so output 2 nguồn cạnh nhau

Mục 2 và 3 là thứ không có sẵn ở đâu. Đó là lý do đáng build.

## 5. Kiến trúc

Stack: **Next.js (App Router) + TypeScript + SQLite**. Một process vừa serve UI vừa có API route — key chỉ sống ở phía server, browser không bao giờ thấy.

```
app/
  page.tsx           → Catalog: bảng model gộp, lọc, so giá
  playground/        → gõ prompt, chọn model, chạy, xem stream
  compare/           → chạy 1 prompt trên 2 provider, so cạnh nhau
  usage/             → chi tiêu theo ngày / model / provider
  settings/          → base URL + key mỗi provider, nút test
  api/
    chat/            → proxy streaming tới provider (nơi DUY NHẤT chạm key)
    models/sync/     → kéo /v1/models về DB
lib/
  provider.ts        → MỘT class OpenAICompatibleProvider(baseUrl, apiKey)
  registry.ts        → đọc config 2 provider từ DB
  pricing.ts         → chuẩn hoá giá, tính tiền từ usage
  db/
```

Vì cả hai cùng chuẩn OpenAI, `lib/provider.ts` là file duy nhất gọi HTTP:

```ts
class OpenAICompatibleProvider {
  constructor(private baseUrl: string, private apiKey: string) {}
  listModels(): Promise<RawModel[]>              // GET  /v1/models
  chat(body, opts): Promise<Response>            // POST /v1/chat/completions (stream passthrough)
  testConnection(): Promise<{ ok, message }>
}
```

Nếu sau khi khảo sát thấy một bên lệch chuẩn (field giá đặt chỗ khác, endpoint model riêng), thì mới thêm hàm `normalize` riêng cho bên đó — không phải cả một adapter.

## 6. Data model (SQLite)

- `provider(id, name, base_url, api_key, enabled, last_checked_at)`
- `model(id, provider_id, external_id, display_name, family, context_len, price_in, price_out, raw_json, synced_at)`
- `run(id, provider_id, model_id, prompt_preview, tokens_in, tokens_out, cost, latency_ms, status, error, created_at)`

`family` là khoá để so giá: chuẩn hoá `claude-opus-4`, `gpt-4o`... về một tên chung, rồi group theo đó để 2 provider nằm cạnh nhau.
`raw_json` giữ nguyên response gốc — sau này cần field mới thì không phải sync lại.

## 7. Các mốc

| Mốc | Nội dung | Xong khi |
|---|---|---|
| **M0** Khảo sát | Lấy base URL + schema `/v1/models` của 2 bên (mục 3) | Có response mẫu thật, ghi vào `docs/api-notes.md` |
| **M1** Khung + Settings | Next.js + SQLite + trang Settings | Dán base URL và key, bấm Test, cả 2 báo OK |
| **M2** Catalog | Sync `/v1/models`, bảng gộp, lọc/tìm | Thấy đủ ~640 model, lọc được theo provider/family |
| **M3** So giá | Chuẩn hoá `family`, group 2 provider, hiện chênh lệch | Gõ "claude", thấy giá 2 bên cạnh nhau và bên nào rẻ hơn |
| **M4** Playground | Gọi `/v1/chat/completions` streaming qua API route | Gõ prompt → chữ chạy ra realtime |
| **M5** Chi tiêu + định tuyến | Log `usage` mỗi run, trang Usage, auto chọn bên rẻ + fallback | Xem được tiêu bao nhiêu tuần này, theo model nào |

Làm tuần tự, mỗi mốc một commit chạy được. M3 là mốc mang lại giá trị thật đầu tiên — nếu muốn nhanh có thể dừng ở đó rồi tính tiếp.

## 8. Cân nhắc trước khi tự build

**Open WebUI** và **LibreChat** đều là mã nguồn mở, chạy local bằng Docker, và **đã hỗ trợ cắm nhiều endpoint OpenAI-compatible cùng lúc**. Nếu bạn chỉ cần một chỗ để chat với model của cả 2 nguồn, cài chúng mất 10 phút và không phải maintain gì.

Cái chúng **không** làm là mục 4.2 và 4.3 — so giá giữa 2 nguồn cho cùng một model, và tự định tuyến sang bên rẻ hơn. Nếu đó là thứ bạn cần, tự build là hợp lý. Nếu không, dùng sẵn sẽ tiết kiệm hơn nhiều.

Gợi ý: cài Open WebUI trước để dùng ngay, song song đó build cái này tập trung vào catalog + so giá + chi tiêu.

## 9. Rủi ro

| Rủi ro | Xử lý |
|---|---|
| Rò rỉ API key | Key chỉ ở server route + SQLite; `.env*`, `*.db` vào `.gitignore`; browser không nhận key |
| `/v1/models` không trả giá | Nhập giá tay ở Settings, hoặc scrape trang bảng giá; giữ `raw_json` để đối chiếu |
| Tên model 2 bên đặt khác nhau | `family` chuẩn hoá bằng bảng ánh xạ tay + fuzzy match; cho sửa tay khi sai |
| Relay đổi endpoint / chết | Health badge ở Settings; lỗi hiện nguyên văn, không nuốt |
| Đốt tiền ngoài ý muốn | Ước tính chi phí trước khi gửi; log `usage` mỗi run; cảnh báo ngưỡng ngày |

## 10. Ngoài phạm vi v1

Đăng nhập / nhiều người dùng · deploy public · tự host model · mobile app · sinh ảnh/video (chờ xác nhận mục 2)

## 11. Bước kế tiếp

1. Chốt: bạn cần **text/chat**, hay thật sự cần **sinh video**? (mục 2)
2. Gỡ chặn khảo sát bằng cách A hoặc B ở mục 3
3. Mình cập nhật plan theo API thật, rồi bắt đầu M1
