# Network Quality Monitor

Demo network performance monitoring with Cloudflare Workers, D1, and Static Assets. Track throughput, latency, packet loss, DNS resolution, and network path analysis over time.

## Features

- **Real-time Metrics**: Download/upload speeds, latency, packet loss, DNS resolution
- **Historical Analysis**: Time-series data with configurable time ranges (24h, 7d, 30d, all-time)
- **Network Path Tracing**: MTR (My Traceroute) analysis with historical snapshots
- **Statistical Insights**: Mean, median, P95, min/max, standard deviation
- **Comparative Analysis**: Automatic comparison of competing services (Cloudflare vs Google DNS, US vs EU endpoints)

## Quick Start

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/DavidJKTofan/cf-internet-speed-visualizer)

```bash
# Install dependencies
npm install

# Create D1 database
npx wrangler d1 create network-quality-db --remote

# Update wrangler.jsonc with the database_id from output

# Initialize schema
npx wrangler d1 execute network-quality-db --file=./schema.sql --remote

# Deploy to Cloudflare
npm run deploy

# Configure the data collection script with your Workers URL
export SPEED_TEST_ENDPOINT="https://your-worker.workers.dev/upload"

# Run collection (requires macOS for NetworkQuality)
chmod +x isp-speed.sh
./isp-speed.sh
```

## Architecture

### Stack

- **Worker**: TypeScript with enterprise error handling and structured logging
- **Database**: Cloudflare D1 (SQLite) with optimized indexes
- **Frontend**: Vanilla JavaScript with Chart.js for visualizations
- **Collector**: Bash script orchestrating multiple network tools

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

### Metrics Collected

| Category           | Metric                  | Source                    | Unit            |
| ------------------ | ----------------------- | ------------------------- | --------------- |
| **Throughput**     | Download/Upload         | NetworkQuality, Speedtest | Mbps            |
| **Latency**        | RTT (min/avg/max)       | ICMP Ping                 | ms              |
| **Latency**        | TTFB                    | cURL                      | ms              |
| **Responsiveness** | RPM                     | NetworkQuality            | round-trips/min |
| **Reliability**    | Packet Loss             | ICMP Ping                 | %               |
| **DNS**            | Query Time              | dig                       | ms              |
| **Path Analysis**  | Hop-by-hop latency/loss | MTR                       | ms, %           |

## Data Collection Script

### Requirements

- **macOS**: Required for `networkQuality` command
- **Optional Tools**: `speedtest-cli`, `mtr` (install via Homebrew)

### Configuration

```bash
# Set endpoint (required)
export SPEED_TEST_ENDPOINT="https://logs.example.com/upload"

# Optional: Skip MTR if sudo is not configured
export SKIP_MTR=true

# Optional: Enable debug logging
export DEBUG=true
```

### Features

- **Retry Logic**: Automatic retry with exponential backoff (3 attempts)
- **Offline Buffering**: Failed uploads are buffered locally and retried on next run
- **Duplicate Detection**: Server-side deduplication by timestamp
- **Error Handling**: Graceful degradation when tools are unavailable

## Automation

### Cron (every hour)

```bash
crontab -e
```

Add:

```
0 * * * * /path/to/isp-speed.sh >> /tmp/network-monitor.log 2>&1
```

### macOS LaunchAgent (every hour)

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
        <string>/path/to/isp-speed.sh</string>
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
    </dict>
</dict>
</plist>
```

Load:

```bash
launchctl load ~/Library/LaunchAgents/com.network.monitor.plist
launchctl start com.network.monitor
```

Check status:

```bash
launchctl list | grep com.network.monitor
```

## Development

### Local Development

```bash
# Run Worker locally with D1
npm run dev

# Tail logs in production
npx wrangler tail

# Query database
npx wrangler d1 execute network-quality-db \
  --command "SELECT COUNT(*) as total,
             AVG(nq_download_mbps) as avg_download
             FROM network_logs"
```

### Database Schema

The schema includes:

- **Constraints**: Check constraints for value ranges (e.g., packet loss 0-100%)
- **Indexes**: Optimized for time-series queries
- **Versioning**: Schema version tracking for migrations

### API Endpoints

#### `POST /upload`

Upload network metrics (batch supported, max 100 entries)

Request:

```json
[{
  "timestamp": "2025-12-05T10:30:00Z",
  "networkquality": {
    "download_mbps": 350.5,
    "upload_mbps": 45.2,
    "responsiveness_rpm": 1247
  },
  "ping": {
    "cloudflare": {
      "host": "1.1.1.1",
      "packet_loss_percent": 0,
      "rtt_ms": { "min": 8.1, "avg": 9.3, "max": 12.4, "stddev": 1.2 }
    },
    "google": { "host": "8.8.8.8", ... }
  },
  "curl": {
    "us_dlsdemo": { "url": "us.dlsdemo.com", "ttfb_s": 0.145, ... },
    "eu_dlsdemo": { ... }
  },
  "speedtest": { ... },
  "dns": { ... },
  "mtr": {
    "cloudflare": {
      "host": "1.1.1.1",
      "hops": [
        { "count": 1, "host": "192.168.1.1", "avg_ms": 2.1, ... },
        ...
      ]
    },
    "google": { ... }
  }
}]
```

Response:

```json
{
	"success": true,
	"inserted": 1,
	"duration_ms": 45,
	"request_id": "req_1733396200_abc123",
	"timestamp": "2025-12-05T10:30:00Z"
}
```

#### `GET /api/logs?limit=1000`

Retrieve historical metrics

Query Parameters:

- `limit`: Number of records (1-10000, default: 1000)

Response: Array of log entries

#### `GET /health`

Health check endpoint

Response:

```json
{
	"status": "healthy",
	"timestamp": "2025-12-05T10:30:00Z",
	"schema_version": 2,
	"checks": {
		"database": "healthy"
	}
}
```

## Frontend Features

### Time Range Filtering

Select from preset ranges or view all historical data:

- Last 24 Hours
- Last 7 Days
- Last 30 Days
- All Time

### Historical MTR Analysis

MTR data is preserved for each collection run. Use the selector dropdown to view network path analysis from different timestamps, enabling:

- **Routing Change Detection**: Compare paths over time
- **ISP Issue Diagnosis**: Identify when packet loss began
- **Performance Regression Analysis**: Track latency changes at specific hops

### Statistical Insights

All metrics include:

- **Mean**: Average value
- **Median**: Middle value (less affected by outliers)
- **P95**: 95th percentile (worst 5% excluded)
- **Min/Max**: Range bounds
- **StdDev**: Variability indicator

## Monitoring & Observability

### Structured Logging

All Worker requests generate structured JSON logs:

```json
{
	"timestamp": "2025-12-05T10:30:00Z",
	"level": "INFO",
	"message": "Successfully inserted entries",
	"request_id": "req_1733396200_abc123",
	"environment": "production",
	"count": 1,
	"duration_ms": 45
}
```

View logs:

```bash
npx wrangler tail --format pretty
```

### Error Handling

- **Client-side**: Automatic retry with exponential backoff
- **Server-side**: Comprehensive validation with detailed error messages
- **Database**: Transaction rollback on failure

### Performance

- **Query Optimization**: Composite indexes on timestamp + metrics
- **Caching**: 60-second TTL on read endpoints
- **Batch Operations**: Single transaction for multiple entries

## Troubleshooting

| Issue                     | Solution                                                                  |
| ------------------------- | ------------------------------------------------------------------------- |
| **Upload fails with 400** | Check JSON structure matches schema; verify timestamp format (ISO 8601)   |
| **Upload fails with 409** | Duplicate timestamp detected; entry already exists in database            |
| **No charts displayed**   | Open browser console; verify `/api/logs` returns valid JSON               |
| **MTR data missing**      | Requires sudo; configure passwordless sudo or set `SKIP_MTR=true`         |
| **NetworkQuality fails**  | Requires macOS 12+ (Monterey); not available on Linux/Windows             |
| **Empty database**        | Run script manually to verify upload; check logs with `npx wrangler tail` |

### Debug Mode

Enable detailed logging in the collection script:

```bash
DEBUG=true ./isp-speed.sh
```

### Check Buffer Directory

If uploads fail, entries are buffered locally:

```bash
ls -la .buffer/
cat .buffer/buffer_*.json
```

## Production Considerations

### Security

- **CORS**: Configure `ALLOWED_ORIGINS` in `index.ts` for production
- **Rate Limiting**: Implement at Worker or Cloudflare level if needed
- **Authentication**: Add API key validation for `/upload` endpoint

### Scaling

- **D1 Limits**: 100k rows/day write limit (sufficient for hourly collection)
- **Data Retention**: Implement cleanup for old records if needed
- **Query Limits**: Frontend fetches max 2000 records (adjust via `?limit=` param)

### Monitoring

- **Cloudflare Dashboard**: Monitor Worker invocations, errors, latency
- **Email Alerts**: Configure alerts for Worker errors
- **Uptime Monitoring**: Use external service to monitor frontend availability

---

# Disclaimer

Educational purposes only.
