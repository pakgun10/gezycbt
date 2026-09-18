#!/usr/bin/env bash
set -euo pipefail
umask 077
release_id="${1:?usage: deploy.sh <release-id> <artifact-dir> }"
artifact_dir="${2:?usage: deploy.sh <release-id> <artifact-dir> }"
root="${GEZYCBT_APP_ROOT:-/opt/gezycbt}"
release="$root/releases/$release_id"
lock="/run/lock/gezycbt-deploy.lock"
[[ "$release_id" =~ ^[A-Za-z0-9._-]{1,80}$ ]] || { echo 'invalid release id' >&2; exit 2; }
[[ -d "$artifact_dir" ]] || { echo 'artifact directory not found' >&2; exit 2; }
mkdir -p "$root/releases" /run/lock
exec 9>"$lock"
flock -n 9 || { echo 'another deployment is running' >&2; exit 3; }
[[ ! -e "$release" ]] || { echo "release already exists: $release" >&2; exit 4; }
install -d -m 0750 "$release"
cp -a "$artifact_dir/." "$release/"
find "$release" -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum >"$release/SHA256SUMS"
export GEZYCBT_RELEASE_ROOT="$release"
# Migrations are forward-only and run before traffic switches to the release.
/usr/local/bin/bun --cwd "$release/apps/api" src/cli/migrate.ts
ln -sfn "$release" "$root/current.next"
mv -Tf "$root/current.next" "$root/current"
systemctl restart gezycbt-api.service
for attempt in {1..20}; do
  if curl --fail --silent --show-error --max-time 2 http://127.0.0.1:3000/health/ready >/dev/null; then
    echo "deployed $release_id"
    exit 0
  fi
  sleep 1
done
echo 'readiness failed; rolling application symlink back' >&2
"$root/current/ops/deployment/previous-release.sh" || true
systemctl restart gezycbt-api.service
exit 1
