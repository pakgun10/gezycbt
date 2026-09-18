# Backup and restore

`backup.sh` creates a MariaDB logical dump and media archive, encrypts both in one artifact with the key outside the repository, writes a SHA-256 sidecar, and optionally copies both to `GEZYCBT_BACKUP_REMOTE` through `rclone`. The daily unit must target storage outside the VPS. The script never logs credentials.

`verify.sh` checks the sidecar, decrypts the archive, and verifies the tar index. `restore.sh` requires `GEZYCBT_CONFIRM_RESTORE=YES` to prevent an accidental destructive restore. After restore, run migrations (forward-only), `/health/ready`, and the three-role smoke test. Keep daily artifacts for 7 days and weekly artifacts for 4 weeks; run a restore drill at least quarterly and before a major exam period.
