# ISS-154 — Capacity report staging production-like

**Status:** PASS untuk baseline 1.000 peserta
**Tanggal:** 19 September 2026
**Host aplikasi/database:** `43.156.50.50`
**Generator:** laptop terpisah
**Batas laporan:** staging, bukan pengukuran production

## Kesimpulan

Dengan konfigurasi saat ini, GezyCBT mampu menjalankan **1.000 peserta
bersamaan** pada schedule MAIN dengan kedatangan peserta tersebar 10 menit,
autosave, reconnect/resume, dan submit. Uji soak 4 jam 10 menit serta satu
restart API terencana lulus correctness dan SLO.

Batas operasi yang didukung oleh evidence ini adalah:

- maksimal 1.000 peserta aktif pada satu ujian dengan pola kedatangan bertahap;
- satu worker export aktif pada satu waktu;
- monitoring guru memakai halaman ter-paginasi dan polling bounded;
- tidak ada klaim bahwa 1.000 login serentak tanpa spread aman untuk operasi
  normal. Spike all-at-once tetap menjadi workload backpressure terpisah.

Kenaikan concurrency, export paralel, atau perubahan parameter Argon2/MariaDB
harus melewati load dan soak ulang.

## Evidence yang digabungkan

| Evidence | Hasil utama |
|---|---|
| [ISS-152 load](./staging-20260919-iss152/README.md) | 1.000 session/result/answer; autosave p95 105 ms; error 0,033% |
| [ISS-153 soak](./staging-20260919-iss153-final/README.md) | 4 jam 10 menit; error 0,0070%; restart recovery; verifier lulus |

## Baseline host

- 2 vCPU.
- RAM 1,9 GiB dan swap 2 GiB.
- Disk root 39 GiB, pemakaian sekitar 21% setelah run.
- Bun 1.4.2, MariaDB 11.8.6, Nginx 1.28.3.
- Bun SQL pool maksimum 8 koneksi.
- MariaDB `Max_used_connections`: 16; tidak mendekati batas 120.
- API process tetap jauh di bawah limit memory service 512 MiB.

## SLO dan headroom terukur

| Signal | Hasil ISS-153 | Target |
|---|---:|---:|
| HTTP/runtime error | 0,0070% | <0,5% |
| Start p95 | 94 ms | <2 s |
| Resume p95 | 178 ms | <2 s |
| Autosave p95 | 168 ms | <750 ms |
| Submit p95 | 173 ms | <3 s |
| Readiness monitor | 1.026/1.026 sample `200` | 100% |
| API RSS monitor | 53–102 MiB | di bawah limit 512 MiB |
| Memory tersedia minimum | sekitar 1,32 GiB | tidak ada memory pressure |

## Bottleneck dan guardrail

1. **Login burst dan Argon2.** Kedatangan bertahap wajib untuk operasi normal.
   `load_1000_once` dipakai hanya untuk mengukur backpressure.
2. **Fan-out query manifest/answer.** Pool tetap 8 sampai ada bukti wait yang
   konsisten; menaikkan pool tanpa menaikkan kapasitas MariaDB tidak dianjurkan.
3. **Restart window.** Restart terencana menghasilkan error transient pada
   request yang tepat beririsan dengan shutdown, tetapi readiness cepat pulih
   dan tidak ada data loss.
4. **Report/export.** Export tetap bounded dan tidak boleh mengambil seluruh
   RAM atau koneksi DB dari jalur answer.

## Rekomendasi operasi

- Pertahankan 1 Bun process, pool 8, dan MariaDB durability settings yang ada.
- Jadwalkan ujian dengan arrival window yang realistis; hindari membuka akses
  untuk 1.000 login pada detik yang sama.
- Pantau readiness, RSS, memory available, `Max_used_connections`, error rate,
  dan disk sebelum serta selama ujian.
- Jalankan export setelah beban answer turun atau gunakan worker bounded.
- Ulangi ISS-152/153 setelah perubahan besar pada schema, Argon2, Nginx,
  Bun, MariaDB, atau konfigurasi pool.

## Batas kesimpulan

Evidence ini tidak mengukur jaringan internet peserta yang sebenarnya, perangkat
mobile, banyak sekolah/tenant, lebih dari 1.000 peserta, atau beban export
besar bersamaan. Pilot nyata tetap wajib dilakukan sebelum production exam.
