-- Network Quality Logs Schema V2 (Enhanced with Constraints and Indexes)
--
-- Enterprise-grade schema with proper constraints, validation, and indexes
-- for production resilience and data integrity.

DROP TABLE IF EXISTS network_logs;

CREATE TABLE IF NOT EXISTS network_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL UNIQUE, -- Prevent duplicate entries
  schema_version INTEGER NOT NULL DEFAULT 2,
  
  -- NetworkQuality metrics
  nq_download_mbps REAL CHECK(nq_download_mbps IS NULL OR nq_download_mbps >= 0),
  nq_upload_mbps REAL CHECK(nq_upload_mbps IS NULL OR nq_upload_mbps >= 0),
  nq_responsiveness_rpm INTEGER CHECK(nq_responsiveness_rpm IS NULL OR nq_responsiveness_rpm >= 0),
  
  -- Ping Cloudflare
  ping_cf_host TEXT,
  ping_cf_packet_loss_percent REAL CHECK(ping_cf_packet_loss_percent IS NULL OR (ping_cf_packet_loss_percent >= 0 AND ping_cf_packet_loss_percent <= 100)),
  ping_cf_rtt_avg REAL CHECK(ping_cf_rtt_avg IS NULL OR ping_cf_rtt_avg >= 0),
  ping_cf_rtt_min REAL CHECK(ping_cf_rtt_min IS NULL OR ping_cf_rtt_min >= 0),
  ping_cf_rtt_max REAL CHECK(ping_cf_rtt_max IS NULL OR ping_cf_rtt_max >= 0),
  ping_cf_rtt_stddev REAL CHECK(ping_cf_rtt_stddev IS NULL OR ping_cf_rtt_stddev >= 0),
  
  -- Ping Google
  ping_google_host TEXT,
  ping_google_packet_loss_percent REAL CHECK(ping_google_packet_loss_percent IS NULL OR (ping_google_packet_loss_percent >= 0 AND ping_google_packet_loss_percent <= 100)),
  ping_google_rtt_avg REAL CHECK(ping_google_rtt_avg IS NULL OR ping_google_rtt_avg >= 0),
  ping_google_rtt_min REAL CHECK(ping_google_rtt_min IS NULL OR ping_google_rtt_min >= 0),
  ping_google_rtt_max REAL CHECK(ping_google_rtt_max IS NULL OR ping_google_rtt_max >= 0),
  ping_google_rtt_stddev REAL CHECK(ping_google_rtt_stddev IS NULL OR ping_google_rtt_stddev >= 0),
  
  -- Curl US
  curl_us_url TEXT,
  curl_us_dns_lookup_s REAL CHECK(curl_us_dns_lookup_s IS NULL OR curl_us_dns_lookup_s >= 0),
  curl_us_ttfb_s REAL CHECK(curl_us_ttfb_s IS NULL OR curl_us_ttfb_s >= 0),
  curl_us_http_code TEXT,
  
  -- Curl EU
  curl_eu_url TEXT,
  curl_eu_dns_lookup_s REAL CHECK(curl_eu_dns_lookup_s IS NULL OR curl_eu_dns_lookup_s >= 0),
  curl_eu_ttfb_s REAL CHECK(curl_eu_ttfb_s IS NULL OR curl_eu_ttfb_s >= 0),
  curl_eu_http_code TEXT,
  
  -- Speedtest
  st_download_mbps REAL CHECK(st_download_mbps IS NULL OR st_download_mbps >= 0),
  st_upload_mbps REAL CHECK(st_upload_mbps IS NULL OR st_upload_mbps >= 0),
  st_ping_ms REAL CHECK(st_ping_ms IS NULL OR st_ping_ms >= 0),
  st_server_location TEXT,
  st_server_country TEXT,
  
  -- DNS
  dns_cf_query_time_ms REAL CHECK(dns_cf_query_time_ms IS NULL OR dns_cf_query_time_ms >= 0),
  dns_google_query_time_ms REAL CHECK(dns_google_query_time_ms IS NULL OR dns_google_query_time_ms >= 0),

  -- MTR (as JSON)
  mtr_cloudflare_hops TEXT,
  mtr_google_hops TEXT,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for query performance
CREATE UNIQUE INDEX IF NOT EXISTS idx_timestamp_unique ON network_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_timestamp_desc ON network_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_created_at ON network_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_schema_version ON network_logs(schema_version);

-- Composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_timestamp_nq_download ON network_logs(timestamp, nq_download_mbps);
CREATE INDEX IF NOT EXISTS idx_timestamp_ping_cf ON network_logs(timestamp, ping_cf_rtt_avg);