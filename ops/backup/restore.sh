#!/usr/bin/env bash
set -euo pipefail
umask 077
if [[ "${GEZYCBT_CONFIRM_RESTORE:-}" != "YES" ]]; then
  echo 'Refusing restore: set GEZYCBT_CONFIRM_RESTORE=YES after checking the target host.' >&2
  exit 2
fi
artifact="${1:?usage: restore.sh <encrypted-backup> }"
: "${GEZYCBT_DATABASE_URL:?GEZYCBT_DATABASE_URL is required}"
media_root="${GEZYCBT_MEDIA_ROOT:-/var/lib/gezycbt/media}"
key_file="${GEZYCBT_BACKUP_KEY_FILE:-/etc/gezycbt/backup.key}"
tmp="$(mktemp -d)"
secret="$(mktemp)"
trap 'rm -rf "$tmp" "$secret"' EXIT
openssl enc -d -aes-256-cbc -pbkdf2 -pass "file:$key_file" -in "$artifact" -out "$tmp/backup.tar.gz"
tar -xzf "$tmp/backup.tar.gz" -C "$tmp"
python3 - "$GEZYCBT_DATABASE_URL" >"$secret" <<'PY'
import sys
from urllib.parse import unquote, urlparse
u = urlparse(sys.argv[1])
print('[client]')
print('host=' + u.hostname)
print('port=' + str(u.port or 3306))
print('user=' + unquote(u.username))
print('password=' + unquote(u.password or ''))
print('database=' + unquote(u.path[1:]))
PY
chmod 600 "$secret"
mariadb --defaults-extra-file="$secret" <"$tmp/database.sql"
mkdir -p "$media_root"
tar -xzf "$tmp/media.tar.gz" -C "$media_root"
echo 'restore completed; run db:migrate, health checks, and smoke tests before traffic.'
