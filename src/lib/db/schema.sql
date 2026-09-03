-- M1 chỉ cần ba bảng. Pool, listing, filter để M2-M3.

CREATE TABLE IF NOT EXISTS client_key (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  key_hash   TEXT NOT NULL UNIQUE,   -- sha256 của key; không bao giờ lưu key thô
  key_prefix TEXT NOT NULL,          -- vài ký tự đầu, chỉ để nhận diện trên UI
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS upstream (
  id         TEXT PRIMARY KEY,
  platform   TEXT NOT NULL,          -- 'ckey' | 'vilao'
  base_url   TEXT NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1
);

-- Một dòng cho MỖI LẦN THỬ, kể cả lần hỏng.
-- M1 chưa fallback nên attempt_no luôn 1, nhưng cột có sẵn để M4 không phải migrate.
CREATE TABLE IF NOT EXISTS run (
  id            TEXT PRIMARY KEY,
  client_key_id TEXT,
  pool_id       TEXT,                -- NULL ở M1
  listing_id    TEXT,                -- external_id của listing đã gọi
  platform      TEXT NOT NULL,
  attempt_no    INTEGER NOT NULL DEFAULT 1,
  requested_model TEXT NOT NULL,     -- model client xin
  actual_model  TEXT,                -- model upstream báo đã dùng; lệch nhau là đáng ngờ
  stream        INTEGER NOT NULL DEFAULT 0,
  tokens_in     INTEGER,
  tokens_out    INTEGER,
  cost_vnd      REAL,
  ttfb_ms       INTEGER,
  latency_ms    INTEGER,
  status        TEXT NOT NULL,       -- 'ok' | 'error' | 'client_abort'
  error_code    TEXT,
  http_status   INTEGER,
  upstream_request_id TEXT,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_run_created ON run(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_run_listing ON run(listing_id);
