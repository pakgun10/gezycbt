# systemd installation

Install units under `/etc/systemd/system`, create a locked `/etc/gezycbt/gezycbt.env`, then run:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now gezycbt-api.service
sudo systemctl enable --now gezycbt-finalize.timer gezycbt-reconcile.timer
sudo systemctl enable --now gezycbt-export-worker.timer gezycbt-housekeeping.timer gezycbt-backup.timer
```

Every timer uses a non-blocking `flock` lock. A missed invocation is safe to rerun because finalization, lifecycle reconciliation, expiry, and export processing are idempotent and bounded. Check `systemctl status`, `journalctl -u <unit>`, and `/health/ready` after installation.
