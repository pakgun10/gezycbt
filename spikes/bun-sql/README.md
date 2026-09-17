# Bun.SQL × MariaDB compatibility spike

Harness ini adalah kode pertama Fase 0. Ia sengaja berdiri sendiri dan tidak mengimpor module production GezyCBT.

## Prasyarat

- Bun `1.4.2` atau versi exact yang tercatat pada [compatibility matrix](../../docs/6-COMPATIBILITY.md).
- MariaDB `11.4.x` dengan database disposable dan user non-root.
- MariaDB `10.11.x` untuk compatibility lane sekunder.

Contoh koneksi lokal:

```bash
SPIKE_DATABASE_URL='mariadb://user:password@127.0.0.1:3306/gezy_spike' \
  bun run spikes/bun-sql/src/index.ts
```

Harness membuat nama tabel unik, membersihkannya pada akhir run, dan tidak menjalankan `DROP DATABASE`. Jangan memakai database production.

## Yang diuji

- koneksi, pool, reserved connection, dan graceful close;
- parameter binding/prepared query serta injection marker;
- `BIGINT`, `DECIMAL`, `JSON`, `BOOLEAN`, Unicode, dan `DATETIME(6)`;
- commit/rollback dan connection pinning di transaction;
- `SELECT ... FOR UPDATE` dengan dua connection;
- unique/check/foreign-key error mapping;
- deadlock dan lock-wait-timeout error code;
- batch insert sekitar 100 row;
- conditional update dan affected-row count;
- reserve cancellation ketika pool penuh;
- query cancellation melalui `KILL QUERY` dan connection timeout probe;
- probe concurrency/RSS;
- Unix socket bila `SPIKE_SOCKET_PATH` diberikan.

Bun.SQL pada release yang diuji tidak mengekspos streaming/cursor API MySQL/MariaDB. Harness mencatatnya sebagai `SKIP`; desain export harus memakai pagination/chunking atau adapter yang mempunyai kemampuan streaming.

Server restart/broken connection recovery memiliki mode manual. Set `SPIKE_RESTART_WAIT_SECONDS` (misalnya `15`), jalankan harness, lalu restart MariaDB ketika pesan `Restart probe ready` muncul. Harness akan menguji pemulihan pada client yang sama dan, bila perlu, client baru. Simpan log run tersebut sebagai evidence `ISS-003`.

Exit code `0` berarti tidak ada assertion yang gagal. `SKIP` bukan bukti pass dan harus tetap dicatat pada laporan spike.
