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
CREATE INDEX IF NOT EXISTS idx_run_pool ON run(pool_id);

-- ── M2: catalog ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS listing (
  id            TEXT PRIMARY KEY,    -- "<platform>:<external_id>"
  platform      TEXT NOT NULL,
  external_id   TEXT NOT NULL,       -- id gửi lên sàn khi gọi
  provider_id   TEXT,                -- Vilao: cần cho subscribe
  seller        TEXT,
  display_name  TEXT NOT NULL,
  base_model    TEXT NOT NULL,       -- tên đã chuẩn hoá, khoá để gom nhóm
  kind          TEXT NOT NULL DEFAULT 'text',
  pricing_mode  TEXT,                -- 'token' | 'request'
  price_in      REAL,                -- VND / 1M token
  price_out     REAL,
  price_request REAL,
  price_floor   REAL,                -- min charge mỗi request
  context_len   INTEGER,
  supports_tools  INTEGER,
  supports_vision INTEGER,
  success_rate  REAL,                -- Vilao công bố; CKey luôn NULL
  total_requests INTEGER,
  avg_latency_ms REAL,
  verified      INTEGER,
  raw_json      TEXT NOT NULL,
  synced_at     TEXT NOT NULL,
  stale         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_listing_base ON listing(base_model);
CREATE INDEX IF NOT EXISTS idx_listing_platform ON listing(platform, stale);

CREATE TABLE IF NOT EXISTS saved_filter (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, filter_json TEXT NOT NULL, created_at TEXT NOT NULL
);

-- ── M3: pool ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pool (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,   -- tên model client gọi
  strategy   TEXT NOT NULL DEFAULT 'failover',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pool_member (
  pool_id    TEXT NOT NULL,
  listing_id TEXT NOT NULL,
  position   INTEGER NOT NULL,
  weight     REAL NOT NULL DEFAULT 1,
  state      TEXT NOT NULL DEFAULT 'active',   -- active | candidate | blocked
  PRIMARY KEY (pool_id, listing_id)
);

-- Vilao từ chối model chưa subscribe vào key, nên phải nhớ đã subscribe cái nào.
CREATE TABLE IF NOT EXISTS subscription (
  listing_id      TEXT PRIMARY KEY,
  upstream_sub_id TEXT,
  subscribed_at   TEXT NOT NULL
);
