# Network Quality Monitor

Real-time network performance monitoring with Cloudflare Workers, D1, and Static Assets.

## Quick Start

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/DavidJKTofan/cf-internet-speed-visualizer)

```bash
# Install dependencies
npm install

# Create D1 database
npx wrangler d1 create network-quality-db --remote

# Update wrangler.jsonc with database_id from output

# Initialize schema
npx wrangler d1 execute network-quality-db --file=./schema.sql --remote

# Deploy
npm run deploy

# Configure bash script with your Workers URL
# Update UPLOAD_ENDPOINT in isp-speed.sh

# Run collection
chmod +x isp-speed.sh
./isp-speed.sh
```

## Architecture

- **Worker**: Handles uploads, serves static assets, caches responses
- **D1**: Stores time-series network metrics
- **Frontend**: Chart.js visualizations with time filtering
- **Collector**: Bash script using NetworkQuality, ping, curl, speedtest

## Metrics

- Download/Upload speed (NetworkQuality, Speedtest)
- RTT latency (Cloudflare, Google)
- Packet loss percentage
- DNS resolution time
- Time to first byte (TTFB)
- Network responsiveness (RPM)

## Automation

### Cron (hourly)

```bash
crontab -e
0 * * * * /path/to/isp-speed.sh >> /tmp/network-monitor.log 2>&1
```

### LaunchAgent

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
        <string>/path/to/isp-speed.sh</string>
    </array>
    <key>StartInterval</key>
    <integer>3600</integer>
</dict>
</plist>
```

Load: `launchctl load ~/Library/LaunchAgents/com.network.monitor.plist`

## Monitoring

```bash
# Live Worker logs
npx wrangler tail

# Query database
npx wrangler d1 execute network-quality-db --command "SELECT COUNT(*) FROM network_logs"
```

## Troubleshooting

**Upload fails**: Check Worker deployment, verify endpoint URL  
**No charts**: Open console, check `/api/logs` returns valid JSON  
**Empty database**: Run script manually, check upload response
