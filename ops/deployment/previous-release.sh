#!/usr/bin/env bash
set -euo pipefail
root="${GEZYCBT_APP_ROOT:-/home/ubuntu/gezycbt}"
current="$(readlink -f "$root/current")"
previous="$(find "$root/releases" -mindepth 1 -maxdepth 1 -type d ! -path "$current" -printf '%T@ %p\n' | sort -nr | head -n1 | cut -d' ' -f2- )"
[[ -n "$previous" ]] || exit 1
ln -sfn "$previous" "$root/current.next"
mv -Tf "$root/current.next" "$root/current"
echo "$previous"
