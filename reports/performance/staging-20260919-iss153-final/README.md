# ISS-153 — Soak dan restart recovery

**Status:** PASS pada staging production-like
**Tanggal:** 19 September 2026
**Host aplikasi:** `43.156.50.50` (2 vCPU, 1.9 GiB RAM, 2 GiB swap)
**Schedule:** `22` (MAIN, 1 attempt per participant)
**Generator:** laptop terpisah dari VPS aplikasi

## Workload

- 1.000 participant, satu iterasi per participant.
- Kedatangan tersebar 600 detik.
- Session ditahan 14.400 detik dengan resume setiap 15 detik.
- Autosave setiap 60 detik.
- Durasi runner aktual: 4 jam 10 menit 14,8 detik.
- Total request: 1.194.817.

## Hasil k6

| Signal | Hasil | Gate |
|---|---:|---:|
| HTTP/runtime error | 84 / 1.194.817 (0,0070%) | `< 0,5%` — lulus |
| Start p95 | 94 ms | `< 2 s` — lulus |
| Resume p95 | 178 ms | `< 2 s` — lulus |
| Autosave p95 | 168 ms | `< 750 ms` — lulus |
| Autosave p99 | threshold lulus | `< 2 s` |
| Submit p95 | 173 ms | `< 3 s` — lulus |
| Iterasi | 1.000 / 1.000 | lulus |

Error yang tercatat bertepatan dengan restart terencana. Setelah service hidup
kembali, readiness kembali `200` dan workload melanjutkan request berikutnya.

## Restart recovery

Restart terencana terjadi pada `2026-09-19T10:44:32Z` (waktu VPS
`18:44:32 +08:00`). Setelah restart:

- `/health/live` dan `/health/ready` kembali normal.
- 1.000 session tetap dapat difinalisasi.
- Tidak ada result atau answer yang hilang.
- Monitor readiness mencatat 0 sample non-`200` selama 1.026 sample.

## Verifikasi database

`data-verification.json` lulus:

- 1.000 session;
- 1.000 participant unik;
- 1.000 result;
- 1.000 answer;
- 0 session aktif;
- tidak ada duplicate main attempt, result, atau answer.

## Resource monitor

Selama monitor:

- RSS API: 53–102 MiB;
- memory tersedia minimum: sekitar 1,32 GiB;
- MariaDB `Max_used_connections`: 16;
- readiness: 100% `200`.

Artefak:

- [`soak-summary.json`](./soak-summary.json)
- [`data-verification.json`](./data-verification.json)
- [`soak-monitor.csv`](./soak-monitor.csv)
- [`host-final.txt`](./host-final.txt)
- [`service-journal.txt`](./service-journal.txt)
- [`db-final.txt`](./db-final.txt)
