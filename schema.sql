-- Network Quality Logs Schema V3 (Modular Endpoint Architecture)
-- Supports unlimited endpoints via JSON columns

DROP TABLE IF EXISTS network_logs;

CREATE TABLE IF NOT EXISTS network_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL UNIQUE,
  schema_version INTEGER NOT NULL DEFAULT 3,
  
  -- NetworkQuality metrics (macOS-specific, single source)
  nq_download_mbps REAL CHECK(nq_download_mbps IS NULL OR nq_download_mbps >= 0),
  nq_upload_mbps REAL CHECK(nq_upload_mbps IS NULL OR nq_upload_mbps >= 0),
  nq_responsiveness_rpm INTEGER CHECK(nq_responsiveness_rpm IS NULL OR nq_responsiveness_rpm >= 0),
  
  -- Speedtest metrics (single source)
  st_download_mbps REAL CHECK(st_download_mbps IS NULL OR st_download_mbps >= 0),
  st_upload_mbps REAL CHECK(st_upload_mbps IS NULL OR st_upload_mbps >= 0),
  st_ping_ms REAL CHECK(st_ping_ms IS NULL OR st_ping_ms >= 0),
  st_server_location TEXT,
  st_server_country TEXT,
  
  -- Dynamic endpoint results (JSON arrays)
  ping_results TEXT, -- Array of {id, name, host, packet_loss_percent, rtt_ms: {min,avg,max,stddev}}
  curl_results TEXT, -- Array of {id, name, host, dns_lookup_s, ttfb_s, http_code}
  mtr_results TEXT,  -- Array of {id, name, host, hops: [...]}
  dns_results TEXT,  -- Array of {id, name, domain, resolver, query_time_ms}

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_timestamp_unique ON network_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_timestamp_desc ON network_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_created_at ON network_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_schema_version ON network_logs(schema_version);
CREATE INDEX IF NOT EXISTS idx_timestamp_nq_download ON network_logs(timestamp, nq_download_mbps);