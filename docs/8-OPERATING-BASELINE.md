# Operating Baseline — Browser, Content, dan Target Operasi

**Status:** Accepted default baseline  
**Tanggal:** 16 September 2026  
**Issue:** `ISS-006`, `ISS-007`, `ISS-008`  
**Berlaku untuk:** MVP sampai pilot; hasil pilot dapat mempersempit matrix melalui perubahan terdokumentasi.

Dokumen ini melengkapi [Compatibility Matrix](./6-COMPATIBILITY.md), [PRD](./4-PRD.md), dan [arsitektur](./01-architecture.md). Ia menetapkan batas yang dipakai implementasi dan pengujian ketika inventaris perangkat sekolah belum tersedia.

## 1. Browser dan perangkat

| Kelas | Baseline didukung | Perangkat acuan | Viewport uji |
|---|---|---|---|
| Android peserta | Chrome Android stable dan satu major sebelumnya; Android 10+ | ponsel RAM 3–4 GiB kelas menengah | 360 × 800 dan 412 × 915 CSS px |
| iPhone peserta | Safari iOS 16+ | iPhone kelas menengah | 375 × 667 dan 390 × 844 CSS px |
| iPad/tablet | Safari iPadOS 16+ atau Chrome Android stable | tablet 10–11 inci | 768 × 1024 CSS px |
| Desktop staff/peserta | Chrome atau Edge stable dan satu major sebelumnya | laptop sekolah | 1366 × 768 CSS px |
| Firefox | Versi ESR/stable saat pilot | desktop | 1366 × 768 CSS px |

Internet Explorer, browser embedded aplikasi, perangkat tanpa IndexedDB/cookie, dan browser yang terlalu lama untuk menerima patch keamanan tidak didukung. Peserta yang memakai browser tidak didukung menerima halaman penjelasan sebelum start, tanpa mencoba membuka session.

Semua flow kritis diuji pada Chrome Android, Safari iOS/iPadOS bila sekolah memakainya, dan Chrome/Edge desktop: login, start, ketiga tipe soal, autosave, refresh/resume, offline/reconnect, timeout, submit, hasil, mode terang/gelap, keyboard, dan touch.

## 2. Batas konten production

| Resource | Baseline | Hard limit MVP | Alasan |
|---|---:|---:|---|
| Soal per exam revision | 50–100 | 150 | manifest, navigasi, dan mobile memory tetap kecil |
| Durasi satu schedule | 30–180 menit | 240 menit | timer dan operasional ujian tetap mudah dipantau |
| Stimulus + pertanyaan per soal | 20 KiB text bersih | 50 KiB | membatasi payload dan editor abuse |
| Opsi choice | 2–10 | 10 | keputusan P-01 |
| Pernyataan TRUE_FALSE | 3 | 3 | scope MVP |
| Media per soal | 0–2 | 3 | download dan rendering mobile |
| Media per file | 2 MiB | 2 MiB | budget disk/bandwidth VPS |
| Dimensi gambar | umum ≤ 1600 px sisi terpanjang | 2500 × 2500 px | mencegah decode memory berlebih |
| Ukuran manifest peserta | target ≤ 500 KiB tanpa binary | 1 MiB | start/resume tetap cepat |
| Peserta aktif per schedule | hingga 1.000 | 1.000 | target kapasitas yang diuji |

Media tidak masuk manifest sebagai base64. Jika authoring memerlukan batas lebih besar, perubahan harus menyertakan hasil profiling perangkat target, dampak backup, dan load test.

## 3. Target layanan dan pemulihan

Target berlaku pada jadwal aktif sampai 1.000 peserta, setelah host memenuhi minimal 2 vCPU, 2 GiB RAM, dan SSD/NVMe.

| Area | Target baseline |
|---|---|
| Availability exam runtime selama jadwal | ≥ 99,5% per jadwal, tidak termasuk gangguan perangkat/jaringan peserta |
| API read penting | p95 ≤ 500 ms |
| Autosave acknowledgement | p95 ≤ 750 ms; p99 ≤ 2 detik |
| Start/resume | p95 ≤ 2 detik tanpa unduh media |
| Submit | p95 ≤ 3 detik; finalisasi tetap idempotent saat retry |
| Error server 5xx saat beban normal | < 0,5% per jadwal |
| RPO di luar ujian | maksimum 24 jam |
| RTO | maksimum 4 jam ke host siap pakai |

SLO adalah target validasi Fase 10, bukan klaim kapasitas sebelum load/soak test. Alert dipicu lebih awal bila p95 autosave > 750 ms selama lima menit, pool database > 80% terpakai, disk bebas < 20%, atau backup lebih tua dari 26 jam.

## 4. Acceptance dan revisi

- [x] `ISS-006`: kelas browser, minimum OS, viewport, dan unsupported behavior ditetapkan.
- [x] `ISS-007`: batas soal, schedule, manifest, dan media ditetapkan.
- [x] `ISS-008`: SLO, RPO, RTO, dan trigger alert awal ditetapkan.

Sebelum pilot, operator mencatat perangkat nyata peserta dan menjalankan regression pada device yang mewakili populasi tersebut. Bila baseline tidak cocok dengan kondisi sekolah, dokumen ini, test matrix, dan issue terdampak diperbarui sebelum go-live.
