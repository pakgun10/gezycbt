# GezyCBT failure response runbook

Never paste a secret, cookie, password, practice token, answer, or answer key into a ticket or command history. Record the UTC time, release ID, request ID, affected schedule, and safe symptom.

## First five minutes

```bash
systemctl status gezycbt-api.service mariadb.service nginx.service
journalctl -u gezycbt-api.service --since '-15 min' --no-pager
curl -fsS http://127.0.0.1:3000/health/live
curl -fsS http://127.0.0.1:3000/health/ready
ops/bin/check-disk || true
df -h /var/lib/gezycbt
```

## Bun/API unavailable

Keep the database running, inspect RSS/OOM and the last release, then restart the API once. Verify readiness and a participant-safe resume smoke test. Do not mass-refresh participant browsers. If readiness remains red, run `ops/deployment/rollback.sh` and keep the failed release for investigation.

## MariaDB unavailable or slow

Check `systemctl status mariadb`, error log and disk. Do not increase the pool during an incident. Once ready, verify one read-only query, then resume traffic; acknowledged answers remain authoritative in MariaDB. Run the timeout finalizer only after database health is stable.

## TLS/Nginx failure

Run `nginx -t`, inspect certificate expiry and the last config change. Restore the previous config or certificate, reload Nginx, and verify headers with `curl -I https://<host>/health/live`. Never bypass TLS to production participants.

## Disk pressure

Upload and export are intentionally rejected first. Run log rotation and inspect `/var/lib/gezycbt/exports`; remove only expired artifacts through housekeeping. Never delete media, database files, or current release directories manually during an exam.

## Finalizer or schedule reconciler delayed

Request-path deadline enforcement remains authoritative. Check the timer and lock, then run the corresponding `systemctl start gezycbt-finalize.service` or `gezycbt-reconcile.service` once. Confirm no duplicate result and inspect finalization lag metrics.

## Backup failure

Do not declare the system recoverable until an encrypted artifact and checksum exist offsite. Run `ops/backup/backup.sh`, `ops/backup/verify.sh`, and open a restore-drill follow-up if either fails. During an exam, prioritize answer durability and defer non-essential exports.

## Restore or release rollback

Restore only on an isolated target with `GEZYCBT_CONFIRM_RESTORE=YES`. After restore, run migrations, health checks, three-role smoke, and a session/result reconciliation before DNS or Nginx traffic is switched. Database schema rollback is never performed by guessing; use expand-and-contract or a forward repair migration.
