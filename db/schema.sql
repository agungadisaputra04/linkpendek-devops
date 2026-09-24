CREATE TABLE IF NOT EXISTS links (
  id         BIGSERIAL PRIMARY KEY,
  slug       TEXT NOT NULL UNIQUE,
  target_url TEXT NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS click_events (
  id       BIGSERIAL PRIMARY KEY,
  link_id  BIGINT NOT NULL REFERENCES links(id),
  ts       TIMESTAMPTZ NOT NULL DEFAULT now(),
  referrer TEXT,
  device   TEXT NOT NULL,
  country  TEXT
);
CREATE INDEX IF NOT EXISTS idx_click_events_link_ts ON click_events (link_id, ts);
