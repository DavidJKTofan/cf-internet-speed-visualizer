# Network Quality Monitor

Real-time network performance monitoring with Cloudflare Workers, D1, and Static Assets. Track throughput, latency, packet loss, DNS resolution, and network path analysis over time.

## Features

- **Real-time Metrics**: Download/upload speeds, latency, packet loss, DNS resolution
- **Historical Analysis**: Time-series data with configurable time ranges (24h, 7d, 30d, all-time)
- **Network Path Tracing**: MTR (My Traceroute) analysis with historical snapshots
- **Statistical Insights**: Mean, median, P95, min/max, standard deviation
- **Comparative Analysis**: Automatic comparison of competing services (Cloudflare vs Google DNS, US vs EU endpoints)

## Quick Start

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/DavidJKTofan/cf-internet-speed-visualizer)

```bash
# 1. Install dependencies
npm install

# 2. Create D1 database
npx wrangler d1 create network-quality-db --remote

# 3. Update wrangler.jsonc with the database_id from output

# 4. Initialize schema
npx wrangler d1 execute network-quality-db --file=./schema.sql --remote

# 5. Deploy to Cloudflare
npm run deploy

# 6. Setup data collection (macOS required)
cd local_script
chmod +x setup-check.sh isp-speed.sh
./setup-check.sh

# 7. Run first collection
export SPEED_TEST_ENDPOINT="https://your-worker.workers.dev/upload"
./isp-speed.sh
```

## Architecture

### Stack

- **Worker**: TypeScript with structured logging and error handling
- **Database**: Cloudflare D1 (SQLite) with optimized indexes
- **Frontend**: Vanilla JavaScript with Chart.js
- **Collector**: Bash script orchestrating network tools

### Data Flow

```
┌─────────────┐         ┌──────────────┐         ┌─────────────┐
│  Local Mac  │  POST   │   CF Worker  │  Write  │  D1 Database│
│   Script    ├────────>│   /upload    ├────────>│   (SQLite)  │
└─────────────┘         └──────────────┘         └─────────────┘
                               │
                               │ GET /api/logs
                               v
                        ┌──────────────┐
                        │   Frontend   │
                        │  Dashboard   │
                        └──────────────┘
```

## Data Collection Script

### Requirements

**Required:**

- macOS (for `networkQuality`)
- jq, bc, curl, dig (install via Homebrew)

**Optional:**

- speedtest-cli (Ookla bandwidth tests)
- mtr (network path tracing – requires `sudo`)

### Configuration

```bash
# Set upload endpoint
export SPEED_TEST_ENDPOINT="https://logs.example.com/upload"

# Optional: Skip MTR (avoids sudo prompt)
export SKIP_MTR=true

# Optional: Debug mode
export DEBUG=true
```

### Running

```bash
# Single run
./isp-speed.sh

# With debug output
DEBUG=true ./isp-speed.sh

# Skip MTR to avoid sudo prompt
SKIP_MTR=true ./isp-speed.sh
```

### Features

- **Modular endpoints**: Configure test targets in `endpoints.config.json`
- **Retry logic**: 3 attempts with exponential backoff
- **Offline buffering**: Failed uploads stored in `.buffer/` and retried
- **Duplicate detection**: Server-side timestamp deduplication
- **Graceful degradation**: Tests continue if optional tools unavailable

## Automation

### Cron (hourly collection)

```bash
crontab -e
```

Add:

```
0 * * * * cd /path/to/local_script && SPEED_TEST_ENDPOINT="https://logs.example.com/upload" ./isp-speed.sh >> /tmp/network-monitor.log 2>&1
```

### macOS LaunchAgent

Create `~/Library/LaunchAgents/com.network.monitor.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.network.monitor</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>/path/to/local_script/isp-speed.sh</string>
    </array>
    <key>StartInterval</key>
    <integer>3600</integer>
    <key>StandardErrorPath</key>
    <string>/tmp/network-monitor-error.log</string>
    <key>StandardOutPath</key>
    <string>/tmp/network-monitor.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>SPEED_TEST_ENDPOINT</key>
        <string>https://logs.example.com/upload</string>
        <key>SKIP_MTR</key>
        <string>true</string>
    </dict>
</dict>
</plist>
```

Load and start:

```bash
launchctl load ~/Library/LaunchAgents/com.network.monitor.plist
launchctl list | grep com.network.monitor
```

## Metrics Collected

| Category           | Metric                  | Source                    | Unit            |
| ------------------ | ----------------------- | ------------------------- | --------------- |
| **Throughput**     | Download/Upload         | NetworkQuality, Speedtest | Mbps            |
| **Latency**        | RTT (min/avg/max)       | ICMP Ping                 | ms              |
| **Latency**        | TTFB                    | cURL                      | ms              |
| **Responsiveness** | RPM                     | NetworkQuality            | round-trips/min |
| **Reliability**    | Packet Loss             | ICMP Ping                 | %               |
| **DNS**            | Query Time              | dig                       | ms              |
| **Path Analysis**  | Hop-by-hop latency/loss | MTR                       | ms, %           |

## API Endpoints

### `POST /upload`

Upload network metrics (batch supported, max 100 entries)

**Headers:**

```
Content-Type: application/json
X-Request-ID: req_<timestamp>_<pid>
CF-Access-Client-Id: <service_token_id>
CF-Access-Client-Secret: <service_token_secret>
```

**Request:**

```json
[
	{
		"timestamp": "2025-12-06T10:30:00Z",
		"networkquality": {
			"download_mbps": 350.5,
			"upload_mbps": 45.2,
			"responsiveness_rpm": 1247
		},
		"speedtest": {
			"download_mbps": 340.2,
			"upload_mbps": 43.1,
			"ping_ms": 10.5,
			"server_location": "Munich",
			"server_country": "Germany"
		},
		"ping_results": [
			{
				"id": "cloudflare",
				"name": "Cloudflare",
				"host": "1.1.1.1",
				"packet_loss_percent": 0,
				"rtt_ms": { "min": 8.1, "avg": 9.3, "max": 12.4, "stddev": 1.2 }
			}
		],
		"curl_results": [
			{
				"id": "us_dlsdemo",
				"name": "US",
				"host": "us.dlsdemo.com",
				"dns_lookup_s": 0.012,
				"ttfb_s": 0.145,
				"http_code": "200"
			}
		],
		"mtr_results": [
			{
				"id": "cloudflare",
				"name": "Cloudflare",
				"host": "1.1.1.1",
				"hops": [{ "count": 1, "host": "192.168.1.1", "avg_ms": 2.1, "loss_percent": 0 }]
			}
		],
		"dns_results": [
			{
				"id": "cloudflare",
				"name": "Cloudflare DNS",
				"domain": "cloudflare.com",
				"resolver": "1.1.1.1",
				"query_time_ms": 12
			}
		]
	}
]
```

**Response:**

```json
{
	"success": true,
	"inserted": 1,
	"duration_ms": 45,
	"request_id": "req_1733396200_abc123",
	"timestamp": "2025-12-06T10:30:00Z"
}
```

### `GET /api/logs?limit=1000`

Retrieve historical metrics

**Query Parameters:**

- `limit`: Number of records (1-10000, default: 1000)

### `GET /health`

Health check endpoint

## Development

### Database Schema

- **Modular architecture**: JSON columns for unlimited endpoints
- **Constraints**: Value range validation (e.g., packet loss 0-100%)
- **Indexes**: Optimized for time-series queries
- **Versioning**: Schema version tracking

Review [schema.sql](schema.sql).

## Troubleshooting

| Issue                      | Solution                                                                                                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Setup validation fails** | Run `./setup-check.sh` to identify missing dependencies                                                                                                         |
| **Upload fails with 302**  | Check Cloudflare Access [Service Token](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/) headers in script |
| **Upload fails with 400**  | Verify JSON structure matches schema; check timestamp format (ISO 8601)                                                                                         |
| **Upload fails with 409**  | Duplicate timestamp - entry already exists in database                                                                                                          |
| **MTR data missing**       | Requires sudo prompt or set `SKIP_MTR=true`                                                                                                                     |
| **NetworkQuality fails**   | Requires macOS 12+ (Monterey)                                                                                                                                   |
| **No charts displayed**    | Open browser console; verify `/api/logs` returns valid JSON                                                                                                     |

### Debug Mode

```bash
DEBUG=true ./isp-speed.sh
```

### Check Buffer Directory

If uploads fail, entries are buffered locally:

```bash
ls -la local_script/.buffer/
cat local_script/.buffer/buffer_*.json
```

### Manual Testing

Test upload endpoint:

```bash
# Test with auth headers
curl -X POST https://logs.example.com/upload \
  -H "Content-Type: application/json" \
  -H "CF-Access-Client-Id: <service_token_id>" \
  -H "CF-Access-Client-Secret: <service_token_secret>" \
  -d '[{"timestamp":"2025-12-06T10:00:00Z","networkquality":{"download_mbps":null,"upload_mbps":null,"responsiveness_rpm":null},"speedtest":{"download_mbps":null},"ping_results":[],"curl_results":[],"mtr_results":[],"dns_results":[]}]' \
  -v
```

## Production Considerations

### Security

- **Authentication**: Cloudflare Access Service Tokens for `/upload`
- **CORS**: Configure `ALLOWED_ORIGINS` in `index.ts`
- **Rate Limiting**: Implement at Worker or Cloudflare level

### Scaling

- **D1 Limits**: 100k rows/day write limit on Free plan (sufficient for hourly collection)
- **Data Retention**: Implement cleanup for old records if needed
- **Query Limits**: Frontend max 2000 records (adjust via `?limit=`)

### Monitoring

- **Cloudflare Dashboard**: Worker invocations, errors, latency
- **Wrangler Tail**: Real-time log streaming
- **Buffer Directory**: Check for failed uploads in `.buffer/`

---

# Disclaimer

Educational purposes only.
