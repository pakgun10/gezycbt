# Fase 10 — Performance validation dan capacity report

**Status:** Tooling ISS-150–ISS-154 tersedia; ISS-152 lulus pada staging
production-like. ISS-153 dan ISS-154 masih menunggu soak/restart dan analisis
capacity final.
**Tanggal:** 18 September 2026

Dokumen ini adalah catatan eksekusi, bukan klaim bahwa 1.000 peserta sudah
terbukti. Bukti kapasitas harus berasal dari staging yang menyerupai VPS target
dan memakai fixture tanpa data/secret production.

## 1. Scope dan workload

Workload participant pada `ops/performance/k6/gezycbt.js` mereproduksi:

1. login username/password;
2. membaca dashboard schedule;
3. start session dengan idempotency key;
4. membaca manifest/resume;
5. batch autosave maksimal lima jawaban;
6. jeda reconnect lalu resume dan save ulang;
7. submit final answers;
8. optional timeout schedule pendek melalui `K6_TIMEOUT_MODE`.

Workload monitoring opsional melakukan login staff dan polling endpoint monitor
50 row. K6 memakai cookie jar per VU, CSRF response dari login, request ID
bounded, dan tidak mencetak response body ke log selain summary yang diminta.

| Profile | Tujuan | Beban |
|---|---|---|
| `smoke` | Validasi kontrak dan fixture | 0 → 10 VU → 0, 60 detik |
| `load_1000` | Kapasitas target | 1.000 peserta, satu alur per peserta, kedatangan bertahap default 10 menit |
| `load_1000_once` | Login spike | 1.000 peserta dimulai bersamaan; mengukur perilaku backpressure |
| `soak` | Drift RSS/connection/queue | hingga 1.000 VU, default 4 jam |

Skenario timeout memakai schedule khusus dengan deadline pendek. Ia tidak
menunggu ujian production selesai.

## 2. Data fixture dan verifier

`generate-fixture.ts` hanya membuat daftar username deterministik. Pembuatan
akun tetap melalui user import resmi supaya password hashing, membership, dan
audit berjalan sama dengan production.

`performance-verify.ts` memeriksa:

- jumlah session dan peserta unik;
- tidak ada duplicate main attempt pada schedule load;
- setiap result session unik;
- setiap answer key `(session_id, session_question_id)` unik;
- jumlah peserta sesuai target fixture bila expected count diberikan.

Latency tanpa verifier dianggap gagal. Verifier tidak menilai isi jawaban atau
answer key dan tidak menampilkan PII.

## 3. Hot query plan

`perf:query-plans` menangkap `EXPLAIN FORMAT=JSON` untuk query start, resume,
answers, timeout finalizer, monitoring, results, schedule target, dan token
lookup. Setiap query memiliki nama stabil serta daftar index yang diharapkan.

Review wajib mencatat:

- access type dan chosen key;
- estimated rows serta filtered percentage;
- temporary/filesort pada query polling/report;
- perubahan plan sebelum dan sesudah tuning;
- alasan menerima full scan bila tabel memang kecil atau query bounded.

Target awal pada dataset representative:

| Query family | Target |
|---|---|
| lookup by id/token/session | `const`, `eq_ref`, atau `ref` dengan rows kecil |
| answer/manifest by session | index range pada `session_id`, tanpa full table scan |
| timeout window | range pada `(status, deadline_at, id)` |
| monitoring/results page | range pada schedule/index dan bounded page; join tidak memindai seluruh tabel |

Migration `0021_performance_indexes` menambahkan index `(schedule_id, id)` pada
session dan result untuk pagination monitoring/results yang memfilter schedule
dan mengurutkan cursor ID. Index itu tetap harus dikonfirmasi dari plan pada
dataset representative; keberadaan DDL saja tidak dianggap bukti.

Target ini adalah review gate, bukan jaminan optimizer MariaDB pada semua
versi. Perubahan index harus disertai migration dan regression test.

## 4. Load acceptance

ISS-152 lulus jika seluruh kondisi berikut terpenuhi pada profile `load_1000`:

- autosave p95 ≤ 750 ms dan p99 ≤ 2 s;
- start/resume p95 ≤ 2 s;
- submit p95 ≤ 3 s;
- HTTP/runtime error < 0,5%;
- tidak ada acknowledged answer loss;
- verifier tidak menemukan duplicate attempt/result/answer;
- DB pool tidak terus menerus di atas 80%;
- disk guard tidak menolak workload normal;
- request timeout/backpressure tetap bounded.

Satu scenario boleh gagal tanpa membatalkan seluruh run hanya bila scenario
tersebut sengaja diisolasi (misalnya timeout test); hasilnya tetap dicatat
terpisah dan tidak boleh menyamarkan failure runtime.

### 4.1 Evidence ISS-152 — staging 19 September 2026

Run diterapkan pada VPS staging `43.156.50.50` dengan 2 vCPU, 1.9 GiB RAM,
2 GiB swap, dan schedule MAIN baru yang menargetkan 1.000 participant. Profile
`load_1000` menjalankan tepat satu alur per participant dengan kedatangan
tersebar 600 detik. Hasil lengkap (summary k6, verifier, host baseline, metrics,
dan query plan) ada di
[`reports/performance/staging-20260919-iss152`](../reports/performance/staging-20260919-iss152/).

Hasil gate:

- HTTP/runtime error 0,033% (2 request gagal dari 5.995), di bawah 0,5%.
- Autosave p95 105 ms dan p99 di bawah 2 detik.
- Start p95 107 ms, resume p95 119 ms, submit p95 1.055 ms.
- Verifier lulus: 1.000 session, participant unik, result, dan answer; tidak
  ada duplicate attempt/result/answer dan tidak ada session aktif tersisa.
- Service tidak restart, readiness tetap sehat, max used MariaDB connections
  16, dan tidak ada disk guard rejection.

Satu participant mengalami kegagalan transient pada alur awal dan diulang sekali
setelah run; kejadian ini tetap berada di bawah error budget dan dicatat eksplisit
di report. Spike 1.000 login serentak tetap dipisahkan sebagai uji backpressure,
bukan dasar kelulusan profile staged.

## 5. Soak dan restart recovery

ISS-153 menggunakan profile `soak` selama durasi ujian terpanjang plus margin
(default empat jam). `soak-monitor.sh` mengambil readiness, RSS API, CPU, load,
dan memory available setiap 15 detik.

Operator melakukan satu restart terencana di tengah soak:

1. catat timestamp dan sample terakhir;
2. restart API melalui systemd pada maintenance window;
3. pastikan `/health/live` cepat pulih dan `/health/ready` pulih setelah DB;
4. jalankan smoke resume/save/submit dengan session yang sudah ada;
5. pastikan queued export/finalizer tidak menggandakan pekerjaan;
6. lanjutkan soak dan bandingkan RSS sebelum/sesudah restart;
7. jalankan verifier setelah run selesai.

Restart recovery tidak boleh menghapus outbox browser atau mengubah result yang
sudah committed.

### 5.1 Batas host generator

K6 harus dijalankan dari host terpisah dari VPS yang sedang diukur. Pada
staging 2 GiB, inisialisasi 1.000 VU k6 mengonsumsi sekitar 1,1 GiB RAM dan
mengubah kondisi yang sedang diukur. Menjalankan generator di VPS target
karena itu bukan evidence kapasitas yang valid dan berisiko menekan MariaDB
serta API. Gunakan laptop/runner CI atau VPS generator terpisah; jangan
memakai VPS production aplikasi sebagai generator tanpa maintenance plan yang
jelas.

Jika runner terputus sebelum semua iterasi selesai, schedule test harus ditutup
dan dibuat ulang. Session yang tersisa boleh difinalisasi untuk cleanup, tetapi
run tersebut tidak boleh diberi status lulus.

## 6. Production baseline awal 2 GiB

File `ops/performance/mariadb-2gb.cnf` dan
`ops/performance/nginx-worker-tuning.conf` hanya template review. Jangan
menyalinnya ke production tanpa backup, maintenance window, dan bukti query/RSS.

Baseline yang harus dicatat di report:

| Komponen | Starting point | Catatan |
|---|---:|---|
| API process | 1 Bun process | scale horizontal belum diasumsikan |
| Bun SQL pool | 8 koneksi | naik hanya bila DB wait terbukti |
| Argon2 queue | 4 aktif, 32 pending | cegah login storm menghabiskan RAM |
| MariaDB buffer pool | 512 MiB | sisakan RAM untuk API/Nginx/kernel |
| MariaDB connections | 120 maksimum | bukan target koneksi aktif |
| Nginx workers | 2 | worker connection 1024 |
| Export worker | 1 job/batch | tidak mengganggu answer path |

Parameter tuning tidak boleh menonaktifkan `innodb_flush_log_at_trx_commit=1`
atau `sync_binlog=1` pada production baseline.

## 7. Capacity report template

Setiap run mengisi metadata berikut:

```text
release:
host:
cpu/memory/swap/disk:
bun_version:
mariadb_version:
nginx_version:
dataset:
profile:
started_at_utc:
finished_at_utc:
k6_summary:
query_plan_report:
data_verification_report:
soak_report:
restart_at_utc:
```

Kesimpulan wajib menyebut safe operating limit, headroom, bottleneck utama,
dan rekomendasi sebelum menaikkan concurrency. Bila gate gagal, issue baru
harus mencatat evidence; angka tidak boleh disesuaikan agar terlihat lulus.
