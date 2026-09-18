#!/usr/bin/env bash
set -euo pipefail
output="${1:-reports/performance/host-baseline.txt}"
mkdir -p "$(dirname "$output")"
{
  printf 'captured_at_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'hostname=%s\n' "$(hostname)"
  printf 'kernel='; uname -srmo
  printf 'cpu_count='; nproc 2>/dev/null || getconf _NPROCESSORS_ONLN
  printf 'memory='; free -h 2>/dev/null || true
  printf 'disk='; df -hT / 2>/dev/null || true
  printf 'ulimits='; ulimit -a 2>/dev/null || true
  for command_name in bun mariadb nginx k6; do
    if command -v "$command_name" >/dev/null 2>&1; then
      printf '%s_version=' "$command_name"
      "$command_name" --version 2>&1 | head -n 1
    else
      printf '%s_version=absent\n' "$command_name"
    fi
  done
  if command -v systemctl >/dev/null 2>&1; then
    printf 'api_service='; systemctl is-active gezycbt-api.service 2>/dev/null || true
  fi
} >"$output"
printf 'host baseline written to %s\n' "$output"
