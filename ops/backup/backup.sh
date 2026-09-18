#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${GEZYCBT_DATABASE_URL:?GEZYCBT_DATABASE_URL is required}"
backup_root="${GEZYCBT_BACKUP_ROOT:-/var/backups/gezycbt}"
media_root="${GEZYCBT_MEDIA_ROOT:-/var/lib/gezycbt/media}"
key_file="${GEZYCBT_BACKUP_KEY_FILE:-/etc/gezycbt/backup.key}"
remote="${GEZYCBT_BACKUP_REMOTE:-}"
retention_days="${GEZYCBT_BACKUP_RETENTION_DAYS:-7}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup_root"
chmod 700 "$backup_root"
stage="$(mktemp -d "${backup_root}/.stage-${stamp}.XXXXXX")"
secret_file="$(mktemp)"
cleanup() { rm -rf "$stage" "$secret_file"; }
trap cleanup EXIT

python3 - "$GEZYCBT_DATABASE_URL" >"$secret_file" <<'PY'
import sys
from urllib.parse import unquote, urlparse
u = urlparse(sys.argv[1])
if u.scheme not in ('mariadb', 'mysql') or not u.hostname or not u.username or len(u.path) < 2:
    raise SystemExit('invalid MariaDB URL')
print('[client]')
print('host=' + u.hostname)
print('port=' + str(u.port or 3306))
print('user=' + unquote(u.username))
print('password=' + unquote(u.password or ''))
print('database=' + unquote(u.path[1:]))
PY
chmod 600 "$secret_file"

dump="$stage/database.sql"
mariadb-dump --defaults-extra-file="$secret_file" --single-transaction --routines --events --triggers >"$dump"
tar -C "$media_root" -czf "$stage/media.tar.gz" .
tar -C "$stage" -czf - database.sql media.tar.gz | openssl enc -aes-256-cbc -salt -pbkdf2 -pass "file:$key_file" >"$backup_root/gezycbt-${stamp}.tar.gz.enc"
sha256sum "$backup_root/gezycbt-${stamp}.tar.gz.enc" >"$backup_root/gezycbt-${stamp}.sha256"
if [[ -n "$remote" ]]; then
  rclone copy "$backup_root/gezycbt-${stamp}.tar.gz.enc" "$remote/"
  rclone copy "$backup_root/gezycbt-${stamp}.sha256" "$remote/"
fi
find "$backup_root" -type f -name 'gezycbt-*.tar.gz.enc' -mtime "+$retention_days" -delete
find "$backup_root" -type f -name 'gezycbt-*.sha256' -mtime "+$retention_days" -delete
echo "backup completed: $backup_root/gezycbt-${stamp}.tar.gz.enc"
