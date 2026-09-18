#!/usr/bin/env bash
set -euo pipefail
umask 077

command -v k6 >/dev/null 2>&1 || {
  echo 'k6 is required on the load-generator host; install it outside this repository.' >&2
  exit 2
}
: "${K6_BASE_URL:?K6_BASE_URL is required}"
: "${K6_FIXTURE_FILE:?K6_FIXTURE_FILE is required}"
[[ -f "$K6_FIXTURE_FILE" ]] || { echo "fixture not found: $K6_FIXTURE_FILE" >&2; exit 2; }

report_root="${K6_REPORT_ROOT:-reports/performance}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
report_dir="$report_root/$stamp"
mkdir -p "$report_dir"
summary="$report_dir/k6-summary.json"

export K6_SUMMARY_FILE="$summary"
k6 run \
  --summary-export "$report_dir/k6-summary-export.json" \
  ops/performance/k6/gezycbt.js \
  | tee "$report_dir/k6.stdout.log"

printf 'k6 evidence: %s\n' "$report_dir"
