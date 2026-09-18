#!/usr/bin/env bash
set -euo pipefail
root="${GEZYCBT_APP_ROOT:-/opt/gezycbt}"
current="$(readlink -f "$root/current")"
previous="$(find "$root/releases" -mindepth 1 -maxdepth 1 -type d ! -path "$current" -printf '%T@ %p\n' | sort -nr | head -n1 | cut -d' ' -f2- )"
[[ -n "$previous" && -d "$previous" ]] || { echo 'no previous release found' >&2; exit 2; }
ln -sfn "$previous" "$root/current.next"
mv -Tf "$root/current.next" "$root/current"
systemctl restart gezycbt-api.service
curl --fail --silent --show-error --max-time 5 http://127.0.0.1:3000/health/ready >/dev/null
echo "rolled back to $(basename "$previous")"
