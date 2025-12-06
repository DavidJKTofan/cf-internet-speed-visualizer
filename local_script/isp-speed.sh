#!/bin/bash

# Network Quality Logger - Production Version
# Requires: jq, bc, curl, networkQuality (macOS), dig

set -euo pipefail

# Initialize variables BEFORE traps
current_command=""
last_command=""
trap 'last_command=$current_command; current_command=$BASH_COMMAND' DEBUG
trap 'echo "[FATAL] Command failed: \"$last_command\" (exit $?) at line $LINENO" >&2; exit 1' ERR

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${CONFIG_FILE:-$SCRIPT_DIR/endpoints.config.json}"
LOG_FILE="$SCRIPT_DIR/network_quality_log.json"
BUFFER_DIR="$SCRIPT_DIR/.buffer"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
START_TIME=$(date +%s)
REQUEST_ID="req_${START_TIME}_$"
UPLOAD_ENDPOINT=${SPEED_TEST_ENDPOINT:-"https://logs.davidjktofan.com/upload"}

MAX_UPLOAD_RETRIES=3
INITIAL_BACKOFF=2
SKIP_MTR=${SKIP_MTR:-false}
DEBUG=${DEBUG:-false}

# Logging
log_info() { echo "[INFO] $*" >&2; }
log_warn() { echo "[WARN] $*" >&2; }
log_error() { echo "[ERROR] $*" >&2; }
log_debug() { [ "$DEBUG" = "true" ] && echo "[DEBUG] $*" >&2 || true; }

# Dependency validation
check_deps() {
    local missing=()
    for cmd in jq bc curl dig; do
        command -v "$cmd" >/dev/null 2>&1 || missing+=("$cmd")
    done
    
    if [ ${#missing[@]} -gt 0 ]; then
        log_error "Missing dependencies: ${missing[*]}"
        log_error "Install: brew install ${missing[*]}"
        exit 1
    fi
    
    command -v networkQuality >/dev/null 2>&1 || log_warn "networkQuality not available (macOS only)"
    command -v speedtest >/dev/null 2>&1 || log_warn "speedtest-cli not installed (optional)"
    command -v mtr >/dev/null 2>&1 || log_warn "mtr not installed (optional)"
}

# Initialize
log_info "Network Quality Logger"
log_info "Request: $REQUEST_ID | Time: $TIMESTAMP"
log_info "Config: $CONFIG_FILE"

check_deps

mkdir -p "$BUFFER_DIR"
[ ! -f "$LOG_FILE" ] && echo "[]" > "$LOG_FILE"

# Validate config
if [ ! -f "$CONFIG_FILE" ]; then
    log_error "Config not found: $CONFIG_FILE"
    exit 1
fi

if ! jq empty "$CONFIG_FILE" 2>/dev/null; then
    log_error "Invalid JSON in config file"
    exit 1
fi

# Load endpoints
PING_ENDPOINTS=$(jq -c '.ping // []' "$CONFIG_FILE")
CURL_ENDPOINTS=$(jq -c '.curl // []' "$CONFIG_FILE")
MTR_ENDPOINTS=$(jq -c '.mtr // []' "$CONFIG_FILE")
DNS_ENDPOINTS=$(jq -c '.dns // []' "$CONFIG_FILE")

log_info "Endpoints loaded: $(echo "$PING_ENDPOINTS" | jq -r 'length') ping, $(echo "$CURL_ENDPOINTS" | jq -r 'length') curl, $(echo "$MTR_ENDPOINTS" | jq -r 'length') mtr, $(echo "$DNS_ENDPOINTS" | jq -r 'length') dns"

# Test functions
run_networkquality() {
    log_info "[1/6] NetworkQuality test"
    
    if ! command -v networkQuality >/dev/null 2>&1; then
        log_warn "  Skipped (not available)"
        echo '{"download_mbps":null,"upload_mbps":null,"responsiveness_rpm":null}'
        return
    fi
    
    local out
    if out=$(networkQuality -c 2>&1) && echo "$out" | grep -q "dl_throughput"; then
        local json
        json=$(echo "$out" | plutil -convert json - -o - 2>/dev/null) || {
            log_warn "  Failed to parse output"
            echo '{"download_mbps":null,"upload_mbps":null,"responsiveness_rpm":null}'
            return
        }
        
        local dl ul rpm
        dl=$(echo "$json" | jq -r '.dl_throughput // null')
        ul=$(echo "$json" | jq -r '.ul_throughput // null')
        rpm=$(echo "$json" | jq -r '.responsiveness // null')
        
        [ "$dl" != "null" ] && dl=$(echo "scale=2; $dl / 1000000" | bc) || dl="null"
        [ "$ul" != "null" ] && ul=$(echo "scale=2; $ul / 1000000" | bc) || ul="null"
        
        log_info "  Download: $dl Mbps | Upload: $ul Mbps | RPM: $rpm"
        echo "{\"download_mbps\":$dl,\"upload_mbps\":$ul,\"responsiveness_rpm\":$rpm}"
    else
        log_warn "  Test failed"
        echo '{"download_mbps":null,"upload_mbps":null,"responsiveness_rpm":null}'
    fi
}

run_speedtest() {
    log_info "[2/6] Speedtest"
    
    if ! command -v speedtest >/dev/null 2>&1; then
        log_warn "  Skipped (not installed)"
        echo '{"download_mbps":null,"upload_mbps":null,"ping_ms":null,"server_location":null,"server_country":null}'
        return
    fi
    
    local out
    out=$(speedtest --format=json --accept-license --accept-gdpr 2>&1) || {
        log_warn "  Test failed"
        echo '{"download_mbps":null,"upload_mbps":null,"ping_ms":null,"server_location":null,"server_country":null}'
        return
    }
    
    if echo "$out" | jq -e '.download.bandwidth' >/dev/null 2>&1; then
        local dl ul ping loc country
        dl=$(echo "$out" | jq -r '.download.bandwidth')
        ul=$(echo "$out" | jq -r '.upload.bandwidth')
        ping=$(echo "$out" | jq -r '.ping.latency')
        loc=$(echo "$out" | jq -r '.server.location')
        country=$(echo "$out" | jq -r '.server.country')
        
        # Convert bytes/s to Mbps
        dl=$(echo "scale=2; $dl * 8 / 1000000" | bc)
        ul=$(echo "scale=2; $ul * 8 / 1000000" | bc)
        
        log_info "  Download: $dl Mbps | Upload: $ul Mbps | Ping: $ping ms"
        echo "{\"download_mbps\":$dl,\"upload_mbps\":$ul,\"ping_ms\":$ping,\"server_location\":\"$loc\",\"server_country\":\"$country\"}"
    else
        log_warn "  Invalid JSON response"
        log_debug "  Output: ${out:0:200}"
        echo '{"download_mbps":null,"upload_mbps":null,"ping_ms":null,"server_location":null,"server_country":null}'
    fi
}

run_ping() {
    local id=$1 name=$2 host=$3
    
    local out
    if out=$(ping -c 10 -W 5000 "$host" 2>&1); then
        local loss rtt
        loss=$(echo "$out" | grep -oE '[0-9\.]+% packet loss' | grep -oE '[0-9\.]+' || echo "0")
        rtt=$(echo "$out" | grep -oE '[0-9\.]+/[0-9\.]+/[0-9\.]+/[0-9\.]+' | head -1)
        
        if [ -n "$rtt" ]; then
            IFS='/' read -r min avg max stddev <<< "$rtt"
            log_info "  $name: ${avg}ms avg, ${loss}% loss"
            echo "{\"id\":\"$id\",\"name\":\"$name\",\"host\":\"$host\",\"packet_loss_percent\":$loss,\"rtt_ms\":{\"min\":$min,\"avg\":$avg,\"max\":$max,\"stddev\":$stddev}}"
        else
            log_warn "  $name: incomplete data"
            echo "{\"id\":\"$id\",\"name\":\"$name\",\"host\":\"$host\",\"packet_loss_percent\":$loss}"
        fi
    else
        log_warn "  $name: failed"
        echo "{\"id\":\"$id\",\"name\":\"$name\",\"host\":\"$host\"}"
    fi
}

run_curl() {
    local id=$1 name=$2 host=$3
    
    local out
    if out=$(curl -o /dev/null -s -w "%{time_namelookup},%{time_starttransfer},%{http_code}" --max-time 30 "https://$host" 2>&1); then
        IFS=',' read -r dns ttfb code <<< "$out"
        log_info "  $name: ${ttfb}s TTFB, HTTP $code"
        echo "{\"id\":\"$id\",\"name\":\"$name\",\"host\":\"$host\",\"dns_lookup_s\":$dns,\"ttfb_s\":$ttfb,\"http_code\":\"$code\"}"
    else
        log_warn "  $name: failed"
        echo "{\"id\":\"$id\",\"name\":\"$name\",\"host\":\"$host\"}"
    fi
}

run_mtr() {
    local id=$1 name=$2 host=$3
    
    if [ "$SKIP_MTR" = "true" ]; then
        echo "{\"id\":\"$id\",\"name\":\"$name\",\"host\":\"$host\",\"hops\":[]}"
        return
    fi
    
    if ! command -v mtr >/dev/null 2>&1; then
        echo "{\"id\":\"$id\",\"name\":\"$name\",\"host\":\"$host\",\"hops\":[]}"
        return
    fi
    
    local out
    if out=$(sudo mtr --json -n -c 5 "$host" 2>&1) && echo "$out" | jq -e '.report.hubs' >/dev/null 2>&1; then
        local result
        result=$(echo "$out" | jq -c --arg id "$id" --arg name "$name" '{
            id: $id,
            name: $name,
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
        log_info "  $name: $(echo "$result" | jq -r '.hops | length') hops"
        echo "$result"
    else
        log_warn "  $name: failed (needs sudo -n)"
        echo "{\"id\":\"$id\",\"name\":\"$name\",\"host\":\"$host\",\"hops\":[]}"
    fi
}

run_dig() {
    local id=$1 name=$2 domain=$3 resolver=$4
    
    local out
    if out=$(dig "$domain" "@$resolver" +stats +time=5 +tries=2 2>&1); then
        local qtime
        qtime=$(echo "$out" | grep "Query time:" | awk '{print $4}' || echo "null")
        log_info "  $name: ${qtime}ms"
        echo "{\"id\":\"$id\",\"name\":\"$name\",\"domain\":\"$domain\",\"resolver\":\"$resolver\",\"query_time_ms\":$qtime}"
    else
        log_warn "  $name: failed"
        echo "{\"id\":\"$id\",\"name\":\"$name\",\"domain\":\"$domain\",\"resolver\":\"$resolver\"}"
    fi
}

# Collect data
log_info "Starting tests..."

nq_data=$(run_networkquality)
st_data=$(run_speedtest)

log_info "[3/6] Ping tests"
ping_array=()
while IFS= read -r ep; do
    [ -z "$ep" ] && continue
    result=$(run_ping \
        "$(echo "$ep" | jq -r '.id')" \
        "$(echo "$ep" | jq -r '.name')" \
        "$(echo "$ep" | jq -r '.host')")
    ping_array+=("$result")
done < <(echo "$PING_ENDPOINTS" | jq -c '.[]')
ping_results=$(printf '%s\n' "${ping_array[@]}" | jq -s '.')

log_info "[4/6] cURL tests"
curl_array=()
while IFS= read -r ep; do
    [ -z "$ep" ] && continue
    result=$(run_curl \
        "$(echo "$ep" | jq -r '.id')" \
        "$(echo "$ep" | jq -r '.name')" \
        "$(echo "$ep" | jq -r '.host')")
    curl_array+=("$result")
done < <(echo "$CURL_ENDPOINTS" | jq -c '.[]')
curl_results=$(printf '%s\n' "${curl_array[@]}" | jq -s '.')

log_info "[5/6] DNS tests"
dns_array=()
while IFS= read -r ep; do
    [ -z "$ep" ] && continue
    result=$(run_dig \
        "$(echo "$ep" | jq -r '.id')" \
        "$(echo "$ep" | jq -r '.name')" \
        "$(echo "$ep" | jq -r '.domain')" \
        "$(echo "$ep" | jq -r '.resolver')")
    dns_array+=("$result")
done < <(echo "$DNS_ENDPOINTS" | jq -c '.[]')
dns_results=$(printf '%s\n' "${dns_array[@]}" | jq -s '.')

log_info "[6/6] MTR tests"
mtr_array=()
while IFS= read -r ep; do
    [ -z "$ep" ] && continue
    result=$(run_mtr \
        "$(echo "$ep" | jq -r '.id')" \
        "$(echo "$ep" | jq -r '.name')" \
        "$(echo "$ep" | jq -r '.host')")
    mtr_array+=("$result")
done < <(echo "$MTR_ENDPOINTS" | jq -c '.[]')
mtr_results=$(printf '%s\n' "${mtr_array[@]}" | jq -s '.')

# Build entry
log_info "Assembling data..."
entry=$(jq -n \
    --arg ts "$TIMESTAMP" \
    --argjson nq "$nq_data" \
    --argjson st "$st_data" \
    --argjson ping "$ping_results" \
    --argjson curl "$curl_results" \
    --argjson mtr "$mtr_results" \
    --argjson dns "$dns_results" \
    '{
        timestamp: $ts,
        networkquality: $nq,
        speedtest: $st,
        ping_results: $ping,
        curl_results: $curl,
        mtr_results: $mtr,
        dns_results: $dns
    }')

log_debug "Entry: $(echo "$entry" | jq -c '{ts:.timestamp,ping:(.ping_results|length)}')"

# Save locally
log_info "Saving to $LOG_FILE"
tmp=$(mktemp)
jq --argjson e "$entry" '. += [$e]' "$LOG_FILE" > "$tmp" && mv "$tmp" "$LOG_FILE"
log_info "Total entries: $(jq 'length' "$LOG_FILE")"

# Upload function
upload() {
    local file=$1 attempt=1 backoff=$INITIAL_BACKOFF
    
    while [ $attempt -le $MAX_UPLOAD_RETRIES ]; do
        log_info "Upload attempt $attempt/$MAX_UPLOAD_RETRIES"
        
        local resp code body
        resp=$(curl -s -X POST "$UPLOAD_ENDPOINT" \
            -H "Content-Type: application/json" \
            -H "X-Request-ID: $REQUEST_ID" \
            -H "CF-Access-Client-Id: <client-id>" \
            -H "CF-Access-Client-Secret: <client-secret>" \
            -d @"$file" \
            -w "\n%{http_code}" \
            --max-time 30 \
            -L 2>&1) || true
        
        code=$(echo "$resp" | tail -1)
        body=$(echo "$resp" | sed '$d')
        
        log_debug "HTTP $code | Body: ${body:0:100}"
        
        case "$code" in
            200)
                log_info "Response code $code"
                log_info "Upload response (first 100 characters): $body"
                log_info "Upload successful"
                return 0
                ;;
            409)
                log_warn "Duplicate entry"
                return 0
                ;;
            302|301)
                log_error "Redirect detected - authentication may be required"
                log_error "Check SPEED_TEST_ENDPOINT and Cloudflare Access configuration"
                ;;
            *)
                log_warn "Upload failed: HTTP $code"
                ;;
        esac
        
        [ $attempt -lt $MAX_UPLOAD_RETRIES ] && sleep $backoff
        backoff=$((backoff * 2))
        attempt=$((attempt + 1))
    done
    
    local buf="$BUFFER_DIR/buffer_$(date +%s)_$.json"
    cp "$file" "$buf"
    log_error "Upload failed, buffered to: $buf"
    return 1
}

# Flush buffers
if compgen -G "$BUFFER_DIR/buffer_*.json" >/dev/null 2>&1; then
    log_info "Flushing buffers..."
    for buf in "$BUFFER_DIR"/buffer_*.json; do
        [ -f "$buf" ] || continue
        log_info "Uploading: $(basename "$buf")"
        upload "$buf" && rm "$buf" && log_info "Buffer cleared"
    done
fi

# Upload current
log_info "Uploading current data..."
tmp=$(mktemp)
echo "[$entry]" > "$tmp"
upload "$tmp" || log_warn "Upload failed but data saved locally"
rm -f "$tmp"

log_info "Complete (runtime: $(($(date +%s) - START_TIME))s)"