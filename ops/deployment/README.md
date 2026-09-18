# Immutable release deployment

Build artifacts in CI, copy them to a new directory, and run `deploy.sh <release-id> <artifact-dir>`. The script validates the release ID, copies into an immutable release directory, records checksums, runs forward-only migrations, atomically switches `/home/ubuntu/gezycbt/current`, restarts the API, and verifies readiness. A failed readiness check restores the previous symlink; migration rollback is never guessed.

`rollback.sh` selects the newest release other than the current one, switches the symlink atomically, restarts the API, and checks readiness. Keep at least one known-good release until the next release passes its observation window.
