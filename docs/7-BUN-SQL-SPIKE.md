# Bun.SQL × MariaDB Compatibility Spike Report

**Issue:** `ISS-003`  
**Status:** `DONE` untuk jalur TCP MariaDB yang diuji; Unix socket dan streaming/cursor dicatat sebagai gap yang disengaja  
**Tanggal run:** 16 September 2026  
**Harness:** [`spikes/bun-sql`](../spikes/bun-sql/)  
**Matrix:** [`6-COMPATIBILITY.md`](./6-COMPATIBILITY.md)

## 1. Keputusan hasil spike

Bun.SQL pada Bun `1.4.2` lulus kebutuhan correctness inti terhadap MariaDB `11.4.13` dan `10.11.19` melalui TCP. Tidak ditemukan gap pada parameter binding, type round-trip, transaction, locking, error mapping, batch insert, conditional update, cancellation probe, atau reconnect setelah restart.

Jalur production dapat melanjutkan dengan Bun.SQL sebagai kandidat utama. `ISS-004` tetap diperlukan untuk mengunci keputusan resmi dan mendokumentasikan official MariaDB Connector sebagai fallback adapter yang dapat dipertahankan di belakang interface repository.

Spike ini tidak menyatakan bahwa Bun.SQL mempunyai streaming/cursor export API. Harness mencatat kemampuan tersebut sebagai `SKIP`; export GezyCBT wajib memakai pagination/chunking atau adapter terpisah sampai ada keputusan dan test baru.

## 2. Environment yang digunakan

| Lane | Runtime | Database | Adapter | Result |
|---|---|---|---|---|
| DB-A | Bun `1.4.2` (`1.4.2+744846f84`) | MariaDB `11.4.13-MariaDB-ubu2404` | Bun.SQL `mariadb` | Lulus |
| DB-B | Bun `1.4.2` (`1.4.2+744846f84`) | MariaDB `10.11.19-MariaDB-ubu2204` | Bun.SQL `mariadb` | Lulus |

Kedua lane memakai database disposable, user non-root, InnoDB, `utf8mb4`, session timezone UTC, pool maksimum 4, dan tabel uji dengan nama acak. Tidak ada schema aplikasi production yang digunakan.

## 3. Evidence run

### 3.1 MariaDB 11.4 — primary lane

Run lengkap dengan restart probe:

```text
PASS 13
FAIL 0
SKIP 2
```

Yang `SKIP`:

- Unix socket karena `SPIKE_SOCKET_PATH` tidak diberikan pada environment host;
- streaming/cursor API karena handle Bun.SQL MySQL/MariaDB pada release yang diuji tidak menyediakan API tersebut.

Restart probe menjalankan query melalui client yang sama setelah container MariaDB direstart dan berhasil pada percobaan pertama. Error sebelum recovery tidak muncul karena Bun mere-establish connection selama window tersebut.

### 3.2 MariaDB 10.11 — compatibility lane

Run TCP tanpa restart probe:

```text
PASS 12
FAIL 0
SKIP 3
```

`SKIP` terdiri dari Unix socket, streaming/cursor, dan restart probe. Hasil type, transaction, locking, error code, batch, dan pool sama-sama lulus.

## 4. Skenario dan hasil penting

| Skenario | Hasil | Evidence ringkas |
|---|---|---|
| Koneksi dan metadata | PASS | Server version, connection ID, `utf8mb4`, dan UTC terbaca |
| Parameter binding/injection marker | PASS | Marker Unicode yang menyerupai SQL tidak mengubah struktur tabel |
| `BIGINT` | PASS | Nilai `9007199254740993` kembali sebagai `bigint` tanpa precision loss |
| `DECIMAL` | PASS | Nilai kembali sebagai string presisi |
| `JSON`/`BOOLEAN`/Unicode | PASS | JSON menjadi object, boolean valid, Unicode utuh |
| `DATETIME(6)` | PASS | Microsecond round-trip diverifikasi melalui `DATE_FORMAT` server |
| Transaction commit/rollback | PASS | Commit terlihat; rollback tidak meninggalkan row |
| Transaction pinning | PASS | Dua query dalam transaction memakai connection ID yang sama |
| `SELECT ... FOR UPDATE` | PASS | Connection kedua menunggu sampai lock dilepas |
| Unique/check/FK errors | PASS | Error code `1062`, `4025`, `1452` terpetakan |
| Deadlock | PASS | Error code `1213` terdeteksi |
| Lock wait timeout | PASS | Error code `1205` terdeteksi |
| Batch insert | PASS | 100 row dalam satu statement |
| Conditional update | PASS | Fresh version affected 1; stale version affected 0 |
| Pool reserve cancellation | PASS | `AbortSignal.timeout` membatalkan wait saat pool penuh |
| Query cancellation | PASS | `KILL QUERY` menghentikan `SLEEP`; error code tercatat |
| Connection timeout/refused | PASS | Koneksi unreachable gagal cepat dan tidak menggantung |
| Restart/reconnect | PASS | Same-client query berhasil setelah MariaDB restart |
| Concurrency/RSS probe | PASS | 100 query concurrent; RSS delta sekitar 1.3–1.9 MiB pada probe |

Probe RSS hanya smoke measurement, bukan capacity result. Capacity tetap harus dibuktikan pada `ISS-150` sampai `ISS-154` dengan workload production.

## 5. Batas dan tindak lanjut

1. Unix socket belum dijalankan karena target spike menggunakan TCP. Jika deployment memilih socket lokal, ulangi harness dengan `SPIKE_SOCKET_PATH` dan lampirkan evidence.
2. Official `mariadb` Connector/Node.js belum dijadikan jalur utama dan belum dibandingkan dalam report ini. Ia tetap fallback yang akan diuji bila ADR-003 memerlukannya atau Bun.SQL mengalami regression.
3. Bun.SQL tidak menyediakan streaming/cursor API yang dapat dipakai langsung pada lane ini. Export tidak boleh mengasumsikan seluruh result berada di memory; gunakan pagination/chunking atau buat spike adapter terpisah.
4. MariaDB `11.8` tidak diuji. Ia bukan production target baseline; perubahan target major memerlukan compatibility rerun.
5. Setiap upgrade Bun, Bun.SQL behavior, atau MariaDB major/minor harus menjalankan ulang skenario correctness dan update ADR bila hasil berubah.

## 6. Acceptance criteria `ISS-003`

- [x] Koneksi TCP dan pool diuji pada dua versi MariaDB.
- [x] Parameter binding, prepared behavior, dan injection marker diuji.
- [x] `BIGINT`, `DECIMAL`, `JSON`, `BOOLEAN`, Unicode, dan `DATETIME(6)` diuji.
- [x] Commit, rollback, transaction pinning, dan conditional update diuji.
- [x] Locking dua connection, deadlock, dan lock-wait-timeout diuji.
- [x] Unique, check, dan foreign-key error mapping diuji.
- [x] Batch insert 100 row dan affected-row count diuji.
- [x] Pool cancellation, query cancellation, dan connection timeout diuji.
- [x] Restart MariaDB dan recovery query diuji pada primary lane.
- [x] Harness menghasilkan log pass/fail/skip yang dapat diulang.
- [x] Tidak ada correctness gap yang memblokir penggunaan Bun.SQL pada target TCP.

## 7. Handoff ke `ISS-004`

ADR-003 perlu menetapkan:

- Bun.SQL sebagai default adapter untuk Bun `1.4.2` dan MariaDB target TCP;
- interface repository tetap adapter-neutral;
- official MariaDB Connector sebagai fallback yang tidak aktif pada baseline;
- trigger re-evaluation: upgrade Bun, perubahan major MariaDB, regression pada type/transaction/error/reconnect, atau kebutuhan streaming export;
- test suite spike dipertahankan sebagai compatibility gate CI untuk perubahan dependency database.

Evidence mentah dapat dibuat ulang dari `SPIKE_DATABASE_URL` dan harness pada direktori `spikes/bun-sql`; credential tidak disimpan dalam repository.
