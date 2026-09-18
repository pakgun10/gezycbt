#!/usr/bin/env bash
set -euo pipefail
umask 077
artifact="${1:?usage: verify.sh <encrypted-backup> }"
key_file="${GEZYCBT_BACKUP_KEY_FILE:-/etc/gezycbt/backup.key}"
sha256sum --check "${artifact%.tar.gz.enc}.sha256"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
openssl enc -d -aes-256-cbc -pbkdf2 -pass "file:$key_file" -in "$artifact" -out "$tmp/backup.tar.gz"
tar -tzf "$tmp/backup.tar.gz" >/dev/null
echo "backup checksum and encrypted archive verified"
