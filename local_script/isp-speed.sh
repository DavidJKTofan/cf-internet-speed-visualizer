#!/bin/bash

# Network Quality Logger
# Collects network metrics and appends to JSON log file

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="$SCRIPT_DIR/network_quality_log.json"
TIMESTAMP=$(date +"%Y-%m-%dT%H:%M:%S%z")
UPLOAD_ENDPOINT="https://logs.davidjktofan.com/upload"

echo "=== Network Quality Logger ==="
echo "Log file: $LOG_FILE"
echo "Timestamp: $TIMESTAMP"
echo ""

# Initialize log file if it doesn't exist
if [ ! -f "$LOG_FILE" ]; then
    echo "[]" > "$LOG_FILE"
    echo "Created new log file"
fi

# Function to run ping and extract stats
run_ping() {
    local host=$1
    local output=$(ping -c 10 "$host" 2>&1)
    local packet_loss=$(echo "$output" | grep -oE '[0-9]+\.[0-9]+% packet loss' | grep -oE '[0-9]+\.[0-9]+')
    local rtt=$(echo "$output" | grep -oE 'min/avg/max/stddev = [0-9.]+/[0-9.]+/[0-9.]+/[0-9.]+' | grep -oE '[0-9.]+/[0-9.]+/[0-9.]+/[0-9.]+')
    
    if [ -n "$rtt" ]; then
        IFS='/' read -r min avg max stddev <<< "$rtt"
        echo "{\"host\":\"$host\",\"packet_loss\":$packet_loss,\"rtt_min\":$min,\"rtt_avg\":$avg,\"rtt_max\":$max,\"rtt_stddev\":$stddev}"
    else
        echo "{\"host\":\"$host\",\"error\":\"failed\"}"
    fi
}

# Function to run curl and extract timing
run_curl() {
    local url=$1
    local output=$(curl -o /dev/null -s -w "%{time_namelookup},%{time_starttransfer},%{http_code}" "https://$url" 2>&1)
    IFS=',' read -r dns ttfb http_code <<< "$output"
    echo "{\"url\":\"$url\",\"dns_lookup\":$dns,\"ttfb\":$ttfb,\"http_code\":\"$http_code\"}"
}

# Run NetworkQuality
echo "[1/5] Running NetworkQuality..."
nq_output=$(networkQuality -s 2>&1)
nq_dl=$(echo "$nq_output" | grep -i "downlink capacity" | grep -oE '[0-9]+' | head -1)
nq_ul=$(echo "$nq_output" | grep -i "uplink capacity" | grep -oE '[0-9]+' | head -1)
nq_responsiveness=$(echo "$nq_output" | grep -i "responsiveness" | grep -oE '[0-9]+' | head -1)

if [ -z "$nq_dl" ]; then nq_dl="null"; fi
if [ -z "$nq_ul" ]; then nq_ul="null"; fi
if [ -z "$nq_responsiveness" ]; then nq_responsiveness="null"; fi
echo "  Download: $nq_dl Mbps | Upload: $nq_ul Mbps | Responsiveness: $nq_responsiveness"

# Run pings
echo "[2/5] Pinging Cloudflare (1.1.1.1)..."
ping_cloudflare=$(run_ping "1.1.1.1")
echo "[3/5] Pinging Google (8.8.8.8)..."
ping_google=$(run_ping "8.8.8.8")

# Run curls
echo "[4/5] Testing US/EU endpoints..."
curl_us=$(run_curl "us.dlsdemo.com")
curl_eu=$(run_curl "eu.dlsdemo.com")

# Run speedtest-cli
echo "[5/5] Running Speedtest..."
if command -v speedtest &> /dev/null; then
    st_output=$(speedtest --format=json 2>&1)
    st_dl=$(echo "$st_output" | grep -oE '"download":\{"bandwidth":[0-9.]+' | grep -oE '[0-9.]+')
    st_ul=$(echo "$st_output" | grep -oE '"upload":\{"bandwidth":[0-9.]+' | grep -oE '[0-9.]+')
    st_ping=$(echo "$st_output" | grep -oE '"latency":[0-9.]+' | grep -oE '[0-9.]+')
    
    if [ -z "$st_dl" ]; then 
        st_dl="null"
    else 
        st_dl=$(echo "scale=2; $st_dl * 8 / 1000000" | bc)
    fi
    if [ -z "$st_ul" ]; then 
        st_ul="null"
    else 
        st_ul=$(echo "scale=2; $st_ul * 8 / 1000000" | bc)
    fi
    if [ -z "$st_ping" ]; then st_ping="null"; fi
    
    echo "  Download: $st_dl Mbps | Upload: $st_ul Mbps | Ping: $st_ping ms"
    speedtest_data="{\"download_mbps\":$st_dl,\"upload_mbps\":$st_ul,\"ping_ms\":$st_ping}"
else
    echo "  ERROR: speedtest not found"
    speedtest_data="{\"error\":\"speedtest not installed\"}"
fi

# Construct JSON entry
entry=$(cat <<EOF
{
  "timestamp": "$TIMESTAMP",
  "networkquality": {
    "download_mbps": $nq_dl,
    "upload_mbps": $nq_ul,
    "responsiveness": $nq_responsiveness
  },
  "ping": {
    "cloudflare": $ping_cloudflare,
    "google": $ping_google
  },
  "curl": {
    "us_dlsdemo": $curl_us,
    "eu_dlsdemo": $curl_eu
  },
  "speedtest": $speedtest_data
}
EOF
)

# Append to log file
echo ""
echo "Writing to log file..."
temp_file=$(mktemp)
jq --argjson entry "$entry" '. += [$entry]' "$LOG_FILE" > "$temp_file" && mv "$temp_file" "$LOG_FILE"

echo "✓ Network quality logged to $LOG_FILE"
echo "✓ Total entries: $(jq '. | length' "$LOG_FILE")"

# Upload to Cloudflare Workers
echo ""
echo "Uploading to Cloudflare Workers..."
upload_response=$(curl -s -X POST "$UPLOAD_ENDPOINT" \
  -H "Content-Type: application/json" \
  -d @"$LOG_FILE" \
  -w "\n%{http_code}")

http_code=$(echo "$upload_response" | tail -n 1)
upload_body=$(echo "$upload_response" | sed '$d')

if [ "$http_code" = "200" ]; then
  echo "✓ Upload successful"
else
  echo "✗ Upload failed (HTTP $http_code)"
  if [ -n "$upload_body" ]; then
    echo "Response: $upload_body"
  fi
fi