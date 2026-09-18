# GezyCBT performance validation

Tooling pada direktori ini dipakai untuk Fase 10 (`ISS-150` sampai
`ISS-154`). Semua command bersifat opt-in dan memakai fixture/staging yang
disediakan operator. Tidak ada credential production yang disimpan di
repository.

## Alur validasi

1. Buat fixture participant untuk host staging:

   ```bash
   bun run perf:fixtures -- --count 1000 --output /tmp/gezycbt-participants.json
   ```

   Generator hanya membuat username deterministik dan password placeholder.
   Akun harus dibuat melalui bootstrap/import resmi; jangan mengubah database
   production dengan script ini.

2. Jalankan load profile k6 terhadap staging:

   ```bash
   K6_BASE_URL=https://staging.example.test \
   K6_FIXTURE_FILE=/tmp/gezycbt-participants.json \
   K6_SCHEDULE_ID=123 \
   K6_MAIN_ACCESS_CODE=ABCDE \
   K6_PROFILE=load_1000 \
   ops/performance/run-k6.sh
   ```

   Profile tersedia: `smoke`, `load_1000`, `load_1000_once`, dan `soak`.
   Gunakan `load_1000_once` untuk schedule utama dengan batas satu attempt per
   peserta; setiap VU melakukan satu alur login sampai submit. `K6_MONITOR=true`
   menambahkan polling monitoring guru; credentials staff diberikan melalui
   `K6_STAFF_USERNAME` dan `K6_STAFF_PASSWORD` hanya dari environment.

3. Capture query plan dari database staging:

   ```bash
   GEZYCBT_DATABASE_URL='mariadb://...' \
   GEZYCBT_QUERY_PLAN_OUTPUT=reports/query-plans.json \
   bun run perf:query-plans
   ```

4. Setelah load selesai, verifikasi invariant database:

   ```bash
   GEZYCBT_DATABASE_URL='mariadb://...' \
   GEZYCBT_SCHEDULE_ID=123 \
   GEZYCBT_EXPECTED_PARTICIPANTS=1000 \
   GEZYCBT_VERIFY_OUTPUT=reports/data-verification.json \
   bun run perf:verify
   ```

5. Ambil baseline host dan pantau soak:

   ```bash
   ops/performance/collect-host-baseline.sh reports/host-baseline.txt
   GEZYCBT_BASE_URL=https://staging.example.test \
   GEZYCBT_SERVICE=gezycbt-api.service \
   GEZYCBT_DURATION_SECONDS=14400 \
   ops/performance/soak-monitor.sh reports/soak.csv
   ```

   Restart recovery dilakukan manual oleh operator pada maintenance window.
   Setelah restart, jalankan health check, ulangi satu iterasi resume/save,
   lalu pastikan outbox/ack dan verifier tetap konsisten.

## SLO dan gate

Target default berasal dari [`08-OPERATING-BASELINE.md`](../../docs/08-OPERATING-BASELINE.md):

| Signal | Target |
|---|---:|
| Autosave p95 | ≤ 750 ms |
| Autosave p99 | ≤ 2 s |
| Start/resume p95 | ≤ 2 s |
| Submit p95 | ≤ 3 s |
| HTTP error rate | < 0,5% |
| Acknowledged answer loss | 0 |
| Duplicate main attempt | 0 |
| RSS growth saat soak | stabil, tanpa trend tidak terbatas |

K6 threshold hanya mengukur service response. `perf:verify` adalah gate
correctness terpisah dan wajib lulus; latency yang baik tidak mengkompensasi
answer loss, result ganda, atau attempt ganda.

## Safety boundary

- Jalankan terhadap staging atau maintenance window yang disetujui.
- Jangan memakai password production di command line; gunakan file fixture
  dengan permission ketat atau environment secret manager.
- Jangan menjalankan `perf:fixtures` atau query plan capture pada production
  tanpa backup dan persetujuan operator.
- Tooling tidak melakukan restart, migration, tuning, atau perubahan data
  secara otomatis.
- `K6_TIMEOUT_WAIT_SECONDS` hanya digunakan pada schedule test khusus dengan
  deadline pendek; jangan menunggu deadline ujian nyata.

## Evidence

Simpan artifact berikut untuk capacity report:

- k6 summary JSON dan raw output;
- `query-plans.json` sebelum/sesudah tuning;
- `data-verification.json`;
- host baseline, RSS/CPU/memory soak CSV;
- versi Bun, MariaDB, Nginx, kernel, dan konfigurasi pool;
- timestamp restart recovery dan hasil health/resume smoke test.

Template analisis dan status gate ada di
[`docs/14-performance-validation.md`](../../docs/14-performance-validation.md).
