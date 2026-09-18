#!/usr/bin/env bash
set -euo pipefail

output="${1:-reports/performance/soak.csv}"
duration="${GEZYCBT_DURATION_SECONDS:-14400}"
interval="${GEZYCBT_SAMPLE_INTERVAL_SECONDS:-15}"
base_url="${GEZYCBT_BASE_URL:-http://127.0.0.1:3000}"
service="${GEZYCBT_SERVICE:-gezycbt-api.service}"
[[ "$duration" =~ ^[0-9]+$ && "$duration" -gt 0 ]] || { echo 'duration must be a positive integer' >&2; exit 2; }
[[ "$interval" =~ ^[0-9]+$ && "$interval" -gt 0 ]] || { echo 'interval must be a positive integer' >&2; exit 2; }
mkdir -p "$(dirname "$output")"
printf 'timestamp_utc,ready,http_code,rss_kib,cpu_percent,load_1m,mem_available_kib\n' >"$output"

start="$(date +%s)"
while :; do
  now="$(date +%s)"
  elapsed=$((now - start))
  (( elapsed >= duration )) && break
  timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  http_code="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --max-time 3 "$base_url/health/ready" 2>/dev/null || printf '000')"
  ready=0
  [[ "$http_code" == "200" ]] && ready=1
  rss=""
  cpu=""
  pid=""
  if command -v systemctl >/dev/null 2>&1; then
    pid="$(systemctl show -p MainPID --value "$service" 2>/dev/null || true)"
  fi
  if [[ "$pid" =~ ^[1-9][0-9]*$ ]] && [[ -r "/proc/$pid/status" ]]; then
    rss="$(awk '/VmRSS:/ {print $2}' "/proc/$pid/status")"
    cpu="$(ps -p "$pid" -o %cpu= | tr -d ' ')"
  fi
  load="$(awk '{print $1}' /proc/loadavg 2>/dev/null || printf '')"
  available="$(awk '/MemAvailable:/ {print $2}' /proc/meminfo 2>/dev/null || printf '')"
  printf '%s,%s,%s,%s,%s,%s,%s\n' "$timestamp" "$ready" "$http_code" "${rss:-0}" "${cpu:-0}" "${load:-0}" "${available:-0}" >>"$output"
  sleep "$interval"
done
printf 'soak samples written to %s\n' "$output"
