#!/bin/bash

# Network Quality Logger - Enterprise Edition
# Collects comprehensive network metrics and uploads to Cloudflare Workers

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="$SCRIPT_DIR/network_quality_log.json"
BUFFER_DIR="$SCRIPT_DIR/.buffer"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%S%z")
REQUEST_ID="req_$(date +%s)_$$"
UPLOAD_ENDPOINT=${SPEED_TEST_ENDPOINT:-"https://logs.davidjktofan.com/upload"}

# Configuration
MAX_UPLOAD_RETRIES=3
INITIAL_BACKOFF=2
SKIP_MTR=${SKIP_MTR:-false}
DEBUG=${DEBUG:-false}

# --- Logging Functions ---
log_info() {
    echo "$(date -u +"%Y-%m-%dT%H:%M:%S") [INFO] $*" >&2
}

log_warn() {
    echo "$(date -u +"%Y-%m-%dT%H:%M:%S") [WARN] $*" >&2
}

log_error() {
    echo "$(date -u +"%Y-%m-%dT%H:%M:%S") [ERROR] $*" >&2
}

log_debug() {
    if [ "$DEBUG" = "true" ]; then
        echo "$(date -u +"%Y-%m-%dT%H:%M:%S") [DEBUG] $*" >&2
    fi
}

# --- Setup ---
init_buffer() {
    if [ ! -d "$BUFFER_DIR" ]; then
        mkdir -p "$BUFFER_DIR"
        log_info "Created buffer directory: $BUFFER_DIR"
    fi
}

log_info "=== Network Quality Logger ==="
log_info "Request ID: $REQUEST_ID"
log_info "Timestamp: $TIMESTAMP"
log_info ""

init_buffer

# Initialize log file if it doesn't exist
if [ ! -f "$LOG_FILE" ]; then
    echo "[]" > "$LOG_FILE"
    log_info "Created new log file"
fi

# --- Data Collection Functions ---

run_networkquality() {
    log_info "[1/7] Running NetworkQuality..."
    local output
    if output=$(networkQuality -c 2>&1); then
        log_debug "NetworkQuality raw output (first 200 chars): ${output:0:200}"
        
        # Convert plist to JSON
        local json
        if json=$(echo "$output" | plutil -convert json - -o - 2>&1); then
            log_debug "Converted to JSON successfully"
            
            # Extract values - NetworkQuality uses dl_throughput/ul_throughput
            local dl=$(echo "$json" | jq -r '.dl_throughput // null')
            local ul=$(echo "$json" | jq -r '.ul_throughput // null')
            local resp=$(echo "$json" | jq -r '.responsiveness // null')
            
            if [ "$dl" != "null" ] && [ "$dl" != "" ]; then
                dl=$(echo "scale=2; $dl / 1000000" | bc)
            else
                dl="null"
            fi
            
            if [ "$ul" != "null" ] && [ "$ul" != "" ]; then
                ul=$(echo "scale=2; $ul / 1000000" | bc)
            else
                ul="null"
            fi
            
            if [ "$resp" = "null" ] || [ "$resp" = "" ]; then
                resp="null"
            fi
            
            log_info "  Download: $dl Mbps | Upload: $ul Mbps | Responsiveness: $resp RPM"
            echo "{\"download_mbps\":$dl,\"upload_mbps\":$ul,\"responsiveness_rpm\":$resp}"
            return
        fi
    fi
    
    log_warn "  NetworkQuality failed"
    echo '{"download_mbps":null,"upload_mbps":null,"responsiveness_rpm":null}'
}

run_speedtest() {
    log_info "[2/7] Running Speedtest..."
    
    if ! command -v speedtest &> /dev/null; then
        log_warn "  Speedtest not found"
        echo '{"download_mbps":null,"upload_mbps":null,"ping_ms":null}'
        return
    fi
    
    local output
    if output=$(speedtest --format=json --accept-license --accept-gdpr 2>&1); then
        log_debug "Speedtest JSON received"
        
        local dl=$(echo "$output" | jq -r '.download.bandwidth // null')
        local ul=$(echo "$output" | jq -r '.upload.bandwidth // null')
        local ping=$(echo "$output" | jq -r '.ping.latency // null')
        local location=$(echo "$output" | jq -r '.server.location // null')
        local country=$(echo "$output" | jq -r '.server.country // null')
        
        if [ "$dl" != "null" ] && [ "$dl" != "" ]; then
            dl=$(echo "scale=2; $dl * 8 / 1000000" | bc)
        else
            dl="null"
        fi
        
        if [ "$ul" != "null" ] && [ "$ul" != "" ]; then
            ul=$(echo "scale=2; $ul * 8 / 1000000" | bc)
        else
            ul="null"
        fi
        
        log_info "  Download: $dl Mbps | Upload: $ul Mbps | Ping: $ping ms"
        
        echo "{\"download_mbps\":$dl,\"upload_mbps\":$ul,\"ping_ms\":$ping,\"server_location\":\"$location\",\"server_country\":\"$country\"}"
        return
    fi
    
    log_warn "  Speedtest failed"
    echo '{"download_mbps":null,"upload_mbps":null,"ping_ms":null}'
}

run_ping() {
    local host=$1
    log_info "[3/7] Pinging $host..."
    
    local output
    if output=$(ping -c 10 "$host" 2>&1); then
        local packet_loss=$(echo "$output" | grep -oE '[0-9\.]+% packet loss' | grep -oE '[0-9\.]+' || echo "0")
        local rtt=$(echo "$output" | grep -oE 'min/avg/max/[a-z]+dev = [0-9\.]+/[0-9\.]+/[0-9\.]+/[0-9\.]+' | grep -oE '[0-9\.]+/[0-9\.]+/[0-9\.]+/[0-9\.]+')
        
        if [ -n "$rtt" ]; then
            IFS='/' read -r min avg max stddev <<< "$rtt"
            log_info "  $host: ${avg}ms avg, ${packet_loss}% loss"
            echo "{\"host\":\"$host\",\"packet_loss_percent\":$packet_loss,\"rtt_ms\":{\"min\":$min,\"avg\":$avg,\"max\":$max,\"stddev\":$stddev}}"
        else
            log_warn "  $host: Could not parse RTT"
            echo "{\"host\":\"$host\",\"packet_loss_percent\":$packet_loss}"
        fi
    else
        log_warn "  $host: Ping failed"
        echo "{\"host\":\"$host\"}"
    fi
}

run_curl() {
    local url=$1
    log_info "[4/7] Testing $url..."
    
    local output
    if output=$(curl -o /dev/null -s -w "%{time_namelookup},%{time_starttransfer},%{http_code}" "https://$url" 2>&1); then
        IFS=',' read -r dns ttfb http_code <<< "$output"
        log_info "  $url: ${ttfb}s TTFB, HTTP $http_code"
        echo "{\"url\":\"$url\",\"dns_lookup_s\":$dns,\"ttfb_s\":$ttfb,\"http_code\":\"$http_code\"}"
    else
        log_warn "  $url: cURL failed"
        echo "{\"url\":\"$url\"}"
    fi
}

run_mtr() {
    local host=$1
    
    if [ "$SKIP_MTR" = "true" ]; then
        log_info "[5/7] Skipping MTR to $host (SKIP_MTR=true)"
        echo "{\"host\":\"$host\"}"
        return
    fi
    
    log_info "[5/7] Running MTR to $host..."
    
    if ! command -v mtr &> /dev/null; then
        log_warn "  MTR not found"
        echo "{\"host\":\"$host\"}"
        return
    fi
    
    # Check sudo
    # if ! sudo -n true 2>/dev/null; then
    #     log_warn "  MTR requires sudo (run: sudo visudo and add passwordless entry)"
    #     echo "{\"host\":\"$host\"}"
    #     return
    # fi
    
    local output
    if output=$(sudo mtr --json -n -c 5 "$host" 2>&1); then
        if echo "$output" | jq -e '.report.hubs' >/dev/null 2>&1; then
            local result
            result=$(echo "$output" | jq -c '{
                host: .report.mtr.dst,
                hops: [.report.hubs[] | {
                    count: .count,
                    host: .host,
                    loss_percent: (."Loss%"),
                    sent: .Snt,
                    last_ms: .Last,
                    avg_ms: .Avg,
                    best_ms: .Best,
                    worst_ms: .Wrst,
                    stddev: .StDev
                }]
            }')
            log_info "  MTR to $host completed"
            echo "$result"
            return
        fi
    fi
    
    log_warn "  MTR to $host failed"
    echo "{\"host\":\"$host\"}"
}

run_dig() {
    local domain=$1
    local resolver=$2
    log_info "[6/7] DNS lookup for $domain via $resolver..."
    
    local output
    if output=$(dig "$domain" "@$resolver" +stats 2>&1); then
        local query_time=$(echo "$output" | grep "Query time:" | awk '{print $4}' || echo "null")
        log_info "  $domain @ $resolver: ${query_time}ms"
        echo "{\"domain\":\"$domain\",\"resolver\":\"$resolver\",\"query_time_ms\":$query_time}"
    else
        log_warn "  $domain @ $resolver: dig failed"
        echo "{\"domain\":\"$domain\",\"resolver\":\"$resolver\"}"
    fi
}

# --- Collect All Data ---
nq_data=$(run_networkquality)
speedtest_data=$(run_speedtest)
ping_cloudflare=$(run_ping "1.1.1.1")
ping_google=$(run_ping "8.8.8.8")
curl_us=$(run_curl "us.dlsdemo.com")
curl_eu=$(run_curl "eu.dlsdemo.com")
mtr_cloudflare=$(run_mtr "1.1.1.1")
mtr_google=$(run_mtr "8.8.8.8")
dns_cf=$(run_dig "cloudflare.com" "1.1.1.1")
dns_google=$(run_dig "google.com" "8.8.8.8")

# --- Construct JSON Entry ---
log_info "[7/7] Assembling data..."

entry=$(jq -n \
  --arg timestamp "$TIMESTAMP" \
  --argjson nq "$nq_data" \
  --argjson speedtest "$speedtest_data" \
  --argjson ping_cf "$ping_cloudflare" \
  --argjson ping_google "$ping_google" \
  --argjson curl_us "$curl_us" \
  --argjson curl_eu "$curl_eu" \
  --argjson mtr_cf "$mtr_cloudflare" \
  --argjson mtr_google "$mtr_google" \
  --argjson dns_cf "$dns_cf" \
  --argjson dns_google "$dns_google" \
  '{
    timestamp: $timestamp,
    networkquality: $nq,
    speedtest: $speedtest,
    ping: {
      cloudflare: $ping_cf,
      google: $ping_google
    },
    curl: {
      us_dlsdemo: $curl_us,
      eu_dlsdemo: $curl_eu
    },
    mtr: {
      cloudflare: $mtr_cf,
      google: $mtr_google
    },
    dns: {
      cloudflare: $dns_cf,
      google: $dns_google
    }
  }')

log_debug "Entry JSON: ${entry:0:200}..."

# --- Save Locally ---
log_info ""
log_info "Saving to local log..."
temp_file=$(mktemp)
jq --argjson entry "$entry" '. += [$entry]' "$LOG_FILE" > "$temp_file" && mv "$temp_file" "$LOG_FILE"
log_info "✓ Saved to $LOG_FILE"
log_info "✓ Total entries: $(jq '. | length' "$LOG_FILE")"

# --- Upload with Retry ---
upload_with_retry() {
    local data_file=$1
    local attempt=1
    local backoff=$INITIAL_BACKOFF
    
    while [ $attempt -le $MAX_UPLOAD_RETRIES ]; do
        log_info ""
        log_info "Upload attempt $attempt/$MAX_UPLOAD_RETRIES..."
        
        local response
        if response=$(curl -s -X POST "$UPLOAD_ENDPOINT" \
            -H "Content-Type: application/json" \
            -H "X-Request-ID: $REQUEST_ID" \
            -d @"$data_file" \
            -w "\n%{http_code}" 2>&1); then
            
            local http_code=$(echo "$response" | tail -n 1)
            local body=$(echo "$response" | sed '$d')
            
            if [ "$http_code" = "200" ]; then
                log_info "✓ Upload successful"
                return 0
            elif [ "$http_code" = "409" ]; then
                log_warn "⚠ Duplicate entry (already uploaded)"
                return 0
            else
                log_warn "✗ Upload failed (HTTP $http_code): ${body:0:100}"
            fi
        else
            log_warn "✗ Upload request failed"
        fi
        
        if [ $attempt -lt $MAX_UPLOAD_RETRIES ]; then
            log_info "Retrying in ${backoff}s..."
            sleep $backoff
            backoff=$((backoff * 2))
        fi
        
        attempt=$((attempt + 1))
    done
    
    log_error "✗ Upload failed after $MAX_UPLOAD_RETRIES attempts"
    
    # Buffer for later
    local buffer_file="$BUFFER_DIR/buffer_$(date +%s)_$$.json"
    echo "[$entry]" > "$buffer_file"
    log_info "⚠ Entry buffered to: $buffer_file"
    return 1
}

# Try to flush any buffered entries first
if ls "$BUFFER_DIR"/buffer_*.json 1> /dev/null 2>&1; then
    log_info ""
    log_info "Flushing buffered entries..."
    for buffer_file in "$BUFFER_DIR"/buffer_*.json; do
        if [ -f "$buffer_file" ]; then
            log_info "Flushing: $(basename "$buffer_file")"
            if upload_with_retry "$buffer_file"; then
                rm "$buffer_file"
                log_info "✓ Flushed and removed"
            fi
        fi
    done
fi

# Upload current entry
temp_upload=$(mktemp)
echo "[$entry]" > "$temp_upload"
upload_with_retry "$temp_upload"
rm "$temp_upload"

log_info ""
log_info "=== Complete ==="