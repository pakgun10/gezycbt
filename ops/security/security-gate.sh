#!/usr/bin/env bash
set -euo pipefail
repo="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$repo"
[[ -f ops/nginx/security-headers.conf ]] || { echo 'security headers missing' >&2; exit 1; }
grep -q "Content-Security-Policy" ops/nginx/security-headers.conf
grep -q "frame-ancestors 'none'" ops/nginx/security-headers.conf
grep -q "location /_protected/media/" ops/nginx/gezycbt.conf
grep -q "internal;" ops/nginx/gezycbt.conf
! git ls-files | grep -E '(^|/)(\.env|.*\.key|.*\.pem)$' >/dev/null
bun run check
if command -v nginx >/dev/null 2>&1; then nginx -t; fi
echo 'security gate passed'
