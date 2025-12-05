-- Network Quality Logs Schema
CREATE TABLE IF NOT EXISTS network_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  
  -- NetworkQuality metrics
  nq_download_mbps REAL,
  nq_upload_mbps REAL,
  nq_responsiveness INTEGER,
  
  -- Ping Cloudflare
  ping_cf_host TEXT,
  ping_cf_packet_loss REAL,
  ping_cf_rtt_avg REAL,
  
  -- Ping Google
  ping_google_host TEXT,
  ping_google_packet_loss REAL,
  ping_google_rtt_avg REAL,
  
  -- Curl US
  curl_us_url TEXT,
  curl_us_dns_lookup REAL,
  curl_us_ttfb REAL,
  curl_us_http_code TEXT,
  
  -- Curl EU
  curl_eu_url TEXT,
  curl_eu_dns_lookup REAL,
  curl_eu_ttfb REAL,
  curl_eu_http_code TEXT,
  
  -- Speedtest
  st_download_mbps REAL,
  st_upload_mbps REAL,
  st_ping_ms REAL,
  
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_timestamp ON network_logs(timestamp DESC);