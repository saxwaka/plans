# Kế hoạch: Web gom API model từ Vilao & CKey

Ngày: 2026-09-02 · Trạng thái: draft, chờ chốt phần "Cần xác nhận"

## 1. Mục tiêu

Một web **chạy local trên máy mình**, làm mặt tiền chung cho 2 nguồn key API (Vilao, CKey):

- Xem gộp danh sách model của cả 2 nguồn trong một bảng
- Chọn model → nhập prompt / upload ảnh → gửi job
- Theo dõi tiến trình, xem kết quả, tải file về máy
- Lưu lịch sử job + chi phí, so sánh giá/tốc độ giữa 2 nguồn cho cùng một model

Không phải: tải file weight (.safetensors) về chạy offline. Đây là gọi API của họ.

## 2. Cần xác nhận trước khi làm (đang chặn M0)

| Câu hỏi | Vì sao quan trọng |
|---|---|
| Domain + link docs của Vilao và CKey | Quyết định viết adapter kiểu gì |
| Có phải chuẩn OpenAI-compatible (`/v1/models`, `/v1/chat/completions`) không? | Nếu có thì 80% code dùng chung được |
| Model ưu tiên là video, ảnh, hay cả chat? | Quyết định form input và cách xử lý output |
| Cơ chế chạy job: trả kết quả ngay, hay submit rồi poll `task_id`? | Quyết định có cần worker/poller không |
| Mỗi bên 1 API key để test | Không có key thì không khảo sát được API |

Nguyên tắc: **không đoán schema**. M0 là ngồi curl thử thật, ghi lại request/response mẫu, rồi mới viết adapter.

## 3. Kiến trúc

Stack: **Next.js (App Router) + TypeScript + SQLite**. Lý do: một process duy nhất vừa serve UI vừa có API route để giấu key khỏi trình duyệt; SQLite là file, không cần cài DB server.

```
app/
  page.tsx              → Models (bảng gộp 2 nguồn)
  generate/             → form tạo job
  jobs/                 → danh sách + trạng thái
  gallery/              → file đã tải
  settings/             → thêm provider, dán key, test connection
  api/                  → route handlers, nơi DUY NHẤT chạm tới API key
lib/
  providers/
    types.ts            → interface Provider
    vilao.ts            → adapter
    ckey.ts             → adapter
    registry.ts
  db/                   → schema + migrations
  jobs/                 → queue + poller
storage/                → video/ảnh tải về (gitignore)
docs/api-notes.md       → output của M0: request/response mẫu thật
```

Interface adapter — mọi khác biệt giữa 2 site bị nhốt sau đây:

```ts
interface Provider {
  id: string
  testConnection(): Promise<{ ok: boolean; message: string }>
  listModels(): Promise<Model[]>
  createJob(modelId: string, params: JobParams): Promise<{ providerJobId: string }>
  getJob(providerJobId: string): Promise<{
    status: 'queued' | 'running' | 'done' | 'failed'
    progress?: number
    outputs?: { url: string; type: 'video' | 'image' }[]
    error?: string
    cost?: number
  }>
}
```

## 4. Data model (SQLite)

- `provider(id, name, base_url, api_key, enabled, last_checked_at)`
- `model(id, provider_id, external_id, name, kind, price_json, params_schema_json, raw_json, synced_at)`
- `job(id, provider_id, model_id, params_json, status, provider_job_id, cost, error, created_at, finished_at)`
- `asset(id, job_id, type, remote_url, local_path, bytes)`

`raw_json` giữ nguyên response gốc của provider → sau này thêm field mới không phải sync lại từ đầu.

## 5. Các mốc

| Mốc | Nội dung | Xong khi |
|---|---|---|
| **M0** Khảo sát API | curl thử cả 2 site, ghi `docs/api-notes.md` | Có request/response mẫu thật của: list model, tạo job, poll job |
| **M1** Khung + Settings | Next.js + SQLite + trang Settings | Dán key vào, bấm "Test connection", cả 2 báo OK |
| **M2** Đồng bộ model | Adapter `listModels()` + trang Models | Bảng hiển thị model của cả 2 nguồn, filter theo provider/loại/giá |
| **M3** Chạy job | `createJob` + `getJob` + poller + trang Jobs | Gửi 1 job thật, thấy nó chạy từ queued → done |
| **M4** Generate + Gallery | Form động theo `params_schema`, tải file về `storage/` | Nhập prompt → ra video → file nằm trên máy |
| **M5** Hoàn thiện | So sánh giá 2 nguồn, tổng chi phí, retry, export CSV | Dùng được hàng ngày mà không phải mở terminal |

Làm tuần tự, mỗi mốc là một commit chạy được. M1–M2 có thể làm song song sau khi M0 xong.

## 6. Rủi ro & cách xử lý

| Rủi ro | Xử lý |
|---|---|
| 2 site schema khác nhau | Adapter + normalize; giữ `raw_json` để không mất dữ liệu |
| Rò rỉ API key | Key chỉ tồn tại ở server route và SQLite; `.env*`, `*.db`, `storage/` vào `.gitignore`; browser không bao giờ thấy key |
| Site relay đổi endpoint hoặc chết | `testConnection()` + health badge ở Settings; lỗi hiện nguyên văn, không nuốt |
| Job treo vô hạn | Timeout theo model, tối đa N job chạy song song, retry có backoff |
| Đốt tiền ngoài ý muốn | Hiện ước tính chi phí trước khi bấm submit; log `cost` từng job; tổng chi phí theo ngày |
| Rate limit | Hàng đợi có giới hạn concurrency, tôn trọng `Retry-After` |

## 7. Ngoài phạm vi v1

- Đăng nhập, nhiều người dùng
- Deploy public ra internet
- Tự host / tự train model
- Mobile app

## 8. Bước kế tiếp

1. Bạn gửi: domain + docs của Vilao và CKey, mỗi bên 1 key test, loại model ưu tiên
2. Mình làm M0, viết `docs/api-notes.md`
3. Chốt lại plan này theo API thật, rồi mới code M1
