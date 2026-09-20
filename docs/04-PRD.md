# Product Requirements Document — GezyCBT

**Status:** Baseline produk disetujui untuk memulai development; belum diimplementasikan  
**Versi dokumen:** 0.1  
**Terakhir diperbarui:** 16 September 2026  
**Pemilik produk:** Pemilik deployment GezyCBT  
**Target deployment:** Satu sekolah, satu deployment, satu database  
**Target kapasitas:** Hingga 1.000 peserta aktif bersamaan  
**Dokumen terkait:** [Arsitektur](./01-architecture.md), [Integrasi External AI Agent](./02-bot-automation.md), [UI/UX](./03-ui-ux.md)

**Baseline review:** `ISS-001` selesai pada 16 September 2026. Dokumen ini menjadi baseline produk v0.1 untuk Fase 0 dan Fase 1.

### Status baseline

Review lintas dokumen terhadap arsitektur v0.13, integrasi agent v0.3, dan UI/UX v0.6 menghasilkan keputusan berikut:

- keputusan produk `P-01` sampai `P-12` telah disetujui dan konsisten di seluruh dokumen;
- batas single-tenant, target satu sekolah, target 1.000 peserta, serta batas VPS sekitar 2 GB tetap berlaku;
- scope core MVP, staging external agent, tiga tipe soal, exact-match scoring, attempt policy, result release, serta exam-session reliability sudah mempunyai requirement dan acceptance scenario;
- UI/UX sudah selaras dengan PRD untuk role menu, theme System/Terang/Gelap, responsive exam flow, accessibility, monitoring, export, dan recovery state;
- `02-bot-automation.md` menetapkan Hivekeep/Hermes sebagai aplikasi eksternal; GezyCBT hanya menyediakan API integrasi dan domain service yang aman;
- belum ada konflik produk yang memerlukan perubahan scope pada baseline ini.

Sejak baseline review, item berikut telah selesai:

- `ISS-002`: compatibility matrix dan environment lanes pada [`06-COMPATIBILITY.md`](./06-COMPATIBILITY.md);
- `ISS-003`: Bun.SQL compatibility spike pada [`07-BUN-SQL-SPIKE.md`](./07-BUN-SQL-SPIKE.md);
- `ISS-004`: keputusan connector pada [`ADR-003`](./adr/ADR-003-bun-sql-vs-mariadb-connector.md).

Gate Fase 0 yang masih terbuka dan bukan keputusan yang boleh ditebak implementer:

1. pengesahan exact dependency dan lockfile pada repository foundation;
2. browser/device matrix nyata sekolah;
3. batas maksimum soal, durasi, manifest, dan media dari data produksi;
4. pengesahan target SLO, RPO, dan RTO oleh pemilik operasional;
5. compatibility spike adapter production Hivekeep atau Hermes.

Perubahan pada keputusan `P-01` sampai `P-12`, scope MVP, scoring, attempt, result visibility, session correctness, authorization, atau agent permission wajib memperbarui PRD sebelum issue implementation terkait dikerjakan.

Dokumen ini menjelaskan **produk apa yang harus dibangun**, untuk siapa, masalah apa yang diselesaikan, ruang lingkup rilis, kebutuhan fungsional, kebutuhan nonfungsional, dan kriteria penerimaannya. Detail implementasi teknis mengikuti dokumen arsitektur. Detail visual dan interaksi mengikuti dokumen UI/UX.

Kata **wajib** menunjukkan kebutuhan yang harus dipenuhi agar fitur diterima. Kata **sebaiknya** menunjukkan kebutuhan penting yang masih dapat ditunda dengan keputusan produk tertulis. Kata **dapat** menunjukkan pilihan implementasi atau pengembangan lanjutan.

---

## 1. Ringkasan produk

GezyCBT adalah aplikasi Computer Based Test untuk satu sekolah. Aplikasi membantu admin dan guru mengelola peserta, data akademik, bank soal, ujian, jadwal, pelaksanaan ujian, hasil, dan audit dalam satu sistem yang ringan serta dapat dijalankan pada VPS sekitar 2 GB RAM.

Peserta mengikuti dua jenis ujian:

1. **Ujian Utama** — peserta mempunyai akun dan masuk dengan username serta password.
2. **Ujian Latihan** — peserta masuk menggunakan token jadwal dan mengisi identitas yang diminta tanpa membuat akun.

Produk mengutamakan:

- jawaban yang sudah diakui server tidak hilang;
- timer dan status ujian ditentukan server;
- peserta dapat melanjutkan setelah refresh atau gangguan koneksi;
- aplikasi tetap mudah dioperasikan sekolah;
- halaman ujian nyaman pada ponsel, tablet, dan desktop;
- sistem mampu menangani 1.000 peserta bersamaan pada infrastruktur yang telah lulus load test;
- pengembangan tetap sederhana melalui modular monolith tanpa Redis dan microservices pada versi awal.

GezyCBT juga menyediakan fondasi integrasi untuk external AI agent seperti Hivekeep atau Hermes Agent. Agent berjalan terpisah dan hanya menggunakan API resmi dengan capability, scope, approval, idempotency, dan audit.

---

## 2. Latar belakang dan masalah

Sekolah membutuhkan sistem ujian yang dapat dipakai pada perangkat peserta yang beragam dan jaringan yang tidak selalu stabil. Sistem harus tetap menjaga integritas waktu, jawaban, attempt, dan hasil ketika banyak peserta mulai, menyimpan, atau mengumpulkan ujian dalam waktu berdekatan.

Masalah utama yang harus diselesaikan:

1. Guru memerlukan cara terstruktur untuk membuat soal, memvalidasi kunci, menyusun ujian, dan menjadwalkannya.
2. Admin memerlukan pengelolaan akun, kelas, mata pelajaran, scope guru, audit, dan pemulihan operasional.
3. Peserta memerlukan halaman ujian yang sederhana, responsif, jelas, dan tahan terhadap refresh serta koneksi terputus.
4. Sekolah memerlukan hasil yang konsisten, dapat dirilis secara terkontrol, dan dapat diekspor.
5. Sistem harus mencegah session, submit, result, atau reset attempt ganda akibat retry dan request paralel.
6. Sistem harus berjalan pada VPS kecil tanpa komponen infrastruktur yang belum diperlukan.
7. Pemilik sekolah ingin dapat menggunakan agent eksternal untuk membantu pekerjaan guru tanpa memberi agent akses langsung ke database atau server.

---

## 3. Visi produk

GezyCBT menjadi sistem ujian sekolah yang dapat dipercaya pada kondisi nyata: perangkat beragam, jaringan tidak stabil, peserta banyak, dan operator terbatas. Setiap keputusan produk harus mendukung kejelasan, keandalan, kesederhanaan operasional, performa, keamanan, dan kemudahan pemeliharaan.

### 3.1 Prinsip produk

1. **Server adalah sumber kebenaran.** Waktu, eligibility, attempt, jawaban tersimpan, finalisasi, dan nilai ditentukan server.
2. **Jawaban peserta menjadi prioritas tertinggi.** Traffic laporan, export, dan agent tidak boleh mengganggu start, autosave, resume, atau submit.
3. **Kegagalan harus dapat dipulihkan.** Refresh, response hilang, process restart, dan koneksi terputus tidak boleh membuat state menjadi ambigu tanpa jalur pemeriksaan.
4. **UI menjelaskan state sebenarnya.** UI tidak boleh menyatakan jawaban tersimpan sebelum acknowledgment server.
5. **Data historis tidak ditulis ulang diam-diam.** Soal, ujian, session, answer, result, dan audit historis dipertahankan melalui revision serta snapshot.
6. **Hak akses selalu diperiksa server.** Menu yang disembunyikan hanya membantu UX.
7. **Fitur baru tidak boleh membebani jalur ujian kritis.** Export, agent, report, dan background job memakai batas resource tersendiri.
8. **Sederhana sampai ada bukti kebutuhan.** Tidak ada Redis, microservices, broker, WebSocket, atau high availability pada versi awal.

---

## 4. Sasaran dan indikator keberhasilan

### 4.1 Sasaran produk

| ID | Sasaran |
|---|---|
| G-01 | Admin dapat menyiapkan sekolah, akun, data akademik, dan scope guru tanpa akses database langsung. |
| G-02 | Guru dapat membuat tiga tipe soal, menyusun ujian, membuat jadwal, memonitor sesi, dan mengelola hasil. |
| G-03 | Peserta utama dapat login, memulai satu attempt yang sah, mengerjakan, resume, dan submit dengan aman. |
| G-04 | Peserta latihan dapat masuk dengan token dan identitas, mengerjakan, serta langsung melihat skor tanpa answer key. |
| G-05 | Sistem dapat melayani beban target 1.000 peserta berdasarkan pengujian pada spesifikasi production. |
| G-06 | Sistem dapat dipulihkan melalui backup, restore, dan runbook yang telah diuji. |
| G-07 | Domain inti siap dipanggil oleh external agent tanpa menduplikasi business rule. |

### 4.2 Indikator penerimaan production

| Indikator | Target awal |
|---|---:|
| Jawaban yang telah acknowledged tetapi hilang | 0 |
| Result ganda untuk satu session | 0 |
| Session ganda yang melanggar attempt policy | 0 |
| p95 current session/auth lookup | ≤150 ms |
| p95 dashboard/list ringan | ≤300 ms |
| p95 start exam | ≤1.000 ms |
| p95 batch autosave | ≤500 ms |
| p95 resume manifest | ≤750 ms |
| p95 submit/finalize | ≤1.500 ms |
| Server error pada jalur ujian | <0,5%; auth lookup <0,1% |
| Peserta load test | 1.000 virtual users dengan pola realistis |
| Audit retention | Minimal 1 tahun |
| Restore drill | Lulus sebelum production dan minimal setiap kuartal |
| Accessibility | Flow kritis memenuhi baseline WCAG 2.2 AA |

Target performa adalah acceptance baseline yang harus divalidasi pada VPS production atau perangkat setara. Ia bukan jaminan sebelum compatibility, load, dan soak test selesai.

---

## 5. Pengguna dan kebutuhan utama

### 5.1 Admin

Admin adalah operator dengan akses sekolah paling luas.

Kebutuhan utama:

- membuat dan mengelola akun admin, guru, dan peserta;
- mengimpor peserta secara aman;
- mengelola tahun ajaran, kelas, roster, mata pelajaran, dan scope guru;
- melihat seluruh bank soal, ujian, jadwal, hasil, export, dan audit;
- mereset attempt peserta;
- mengelola integration client serta grant agent;
- melakukan tindakan pemulihan akun dan operasi sensitif dengan audit.

### 5.2 Guru

Guru bekerja dalam subject/class/resource scope yang ditetapkan.

Kebutuhan utama:

- mengelola bank soal serta revision soal;
- membuat, memvalidasi, dan menerbitkan ujian;
- membuat jadwal utama atau latihan;
- memonitor peserta;
- memperpanjang waktu atau mengakhiri satu sesi sesuai izin;
- menutup jadwal yang dikelola;
- melihat, merilis, menyembunyikan kembali, dan mengekspor hasil sesuai scope.

### 5.3 Peserta utama

Peserta utama mempunyai akun sekolah.

Kebutuhan utama:

- login dengan username dan password;
- memasukkan kode ujian utama lima karakter bila schedule memintanya; kode ini hanya kode tambahan dan tidak menggantikan login;
- melihat ujian yang tersedia;
- memulai atau melanjutkan ujian;
- mengetahui timer, koneksi, dan status simpan;
- tetap dapat mengisi jawaban ketika koneksi sementara terputus;
- melanjutkan setelah refresh atau login dari perangkat lain;
- mengumpulkan ujian sekali dan melihat hasil hanya setelah dirilis.

### 5.4 Peserta latihan

Peserta latihan tidak memerlukan akun.

Kebutuhan utama:

- memasukkan token latihan;
- mengisi identitas sesuai konfigurasi jadwal;
- mengikuti ujian melalui session tamu yang terisolasi;
- melihat skor agregat langsung setelah selesai;
- mengulang latihan bila server menyatakan diizinkan.

Token latihan adalah kode akses bersama lima karakter untuk kemudahan distribusi, bukan pengganti kontrol server. Window jadwal, rate limit, generic error, rotasi, dan pembatasan session/result tetap wajib.

### 5.5 Pemilik integration client

Pemilik dapat berupa admin atau guru dan menggunakan Hivekeep/Hermes melalui channel yang dikelola platform agent.

Kebutuhan utama:

- meminta agent mencari, membuat, atau mengubah draft soal;
- memasukkan soal ke draft ujian;
- meminta ringkasan atau export hasil;
- mengetahui dampak tindakan sebelum menyetujuinya;
- memastikan agent tidak melampaui role, scope, grant, atau lifecycle aplikasi.

---

## 6. Ruang lingkup rilis

### 6.1 Core MVP web

Core MVP wajib mencakup:

- single-school settings;
- akun dan autentikasi admin, guru, peserta;
- tahun ajaran, kelas, roster, mata pelajaran, dan scope guru;
- import peserta dengan preview;
- bank soal serta tiga tipe soal;
- media gambar soal;
- revision dan publish soal;
- exam authoring dan revision;
- jadwal `MAIN` dan `PRACTICE`;
- participant dashboard, start, autosave, offline outbox, resume, submit, dan timeout;
- monitoring, time extension, Akhiri Sesi, Tutup Jadwal, dan reset attempt;
- scoring, result release/unrelease, serta export CSV;
- audit log;
- light, dark, dan system theme;
- deployment, observability, backup, restore, dan runbook minimum.

### 6.2 Fondasi agent pada core

Fondasi berikut wajib dibangun bersama domain inti meskipun tool percakapan belum dirilis:

- application service tidak bergantung pada route web;
- actor context membedakan human, external agent, system job, dan recovery;
- mutation penting mendukung idempotency serta expected version;
- DTO peserta, staf, dan agent dipisahkan;
- audit dapat mengaitkan owner dan integration client;
- export berbentuk controlled job;
- domain rule tidak diduplikasi pada adapter agent.

### 6.3 Rilis agent bertahap setelah workflow inti stabil

| Tahap | Scope |
|---|---|
| Agent A | Integration client, credential, grant, discovery, kill switch, dan read-only tools |
| Agent B | CRUD draft soal, media, validation, dan version conflict |
| Agent C | Exam authoring, memasukkan soal, dan publish dengan approval |
| Agent D | Hasil, practice result, export, dan download token |
| Agent E | Tindakan risiko tinggi: close schedule, end session, extension, reset attempt, dan release result |

Kegagalan atau downtime agent tidak boleh mengurangi fungsi web GezyCBT.

### 6.4 Di luar scope versi awal

- multi-tenant dalam satu deployment;
- Redis;
- microservices;
- message broker atau service mesh;
- WebSocket/SSE untuk timer atau autosave;
- aplikasi mobile native;
- essay dan penilaian manual;
- partial score;
- video/audio pada soal;
- SVG/HTML upload;
- advanced anti-cheating atau proctoring;
- recovery code untuk peserta latihan yang kehilangan browser/cookie;
- high availability lintas server;
- email/self-service password recovery;
- MFA staff;
- answer-key review per soal untuk peserta latihan;
- browser print sebagai hasil resmi;
- PDF siap cetak pada MVP;
- autonomous agent tanpa permintaan, grant, policy, dan approval yang sesuai.

---

## 7. Keputusan produk yang dikunci

| ID | Keputusan |
|---|---|
| P-01 | Soal choice memiliki minimal 2 dan maksimal 10 opsi. |
| P-02 | Ujian utama memiliki 1 attempt per peserta per schedule, kecuali reset attempt resmi. |
| P-03 | Latihan dapat diulang; setiap start membuat session baru sesuai eligibility server. |
| P-04 | Jadwal memakai hard stop; deadline peserta tidak melewati `ends_at`. |
| P-05 | Hasil ujian utama tidak langsung terlihat dan harus dirilis guru/admin. |
| P-06 | Hasil latihan langsung terlihat tanpa answer key atau correctness per soal. |
| P-07 | Nama latihan wajib; instansi dan kelas optional/configurable. |
| P-08 | Urutan soal dan opsi choice dapat diacak; tiga pernyataan true/false tidak diacak. |
| P-09 | Bobot soal adalah desimal positif dengan default 1. |
| P-10 | Peserta utama dapat resume dari perangkat lain setelah login ulang. |
| P-11 | UI memakai zona `Asia/Jakarta`; waktu database disimpan UTC. |
| P-12 | Audit disimpan minimal 1 tahun. |

Perubahan keputusan ini memerlukan pembaruan PRD, analisis dampak schema/API/UI/test, dan ADR bila berdampak teknis.

---

## 8. Information architecture dan pemisahan area

### 8.1 Area admin

- Dashboard
- Pengguna
- Akademik
- Guru & Scope
- Integrasi Agent
- Audit Log
- Pengaturan

### 8.2 Area guru

- Dashboard
- Bank Soal
- Ujian
- Jadwal
- Monitoring
- Hasil & Export

### 8.3 Area peserta

- Login peserta utama
- Dashboard peserta
- Pre-exam
- Halaman ujian
- Konfirmasi/hasil
- Akses latihan dengan token dan identitas

### 8.4 Menu dan role

| Area/menu | Admin | Guru | Peserta |
|---|---:|---:|---:|
| Dashboard sesuai role | Ya | Ya | Ya |
| Pengguna | Ya | Tidak | Tidak |
| Akademik | Ya | Sesuai scope terbatas | Tidak |
| Guru & Scope | Ya | Tidak | Tidak |
| Bank Soal | Semua | Milik/diberikan | Tidak |
| Ujian/Jadwal | Semua | Yang dikelola | Tidak |
| Monitoring | Semua | Yang dikelola | Tidak |
| Hasil & Export | Semua | Yang dikelola | Hasil sendiri yang dirilis |
| Integrasi Agent | Ya | Tidak pada baseline management | Tidak |
| Audit Log | Ya | Tidak | Tidak |
| Pengaturan sekolah | Ya | Tidak | Tidak |

Deep link yang tidak diizinkan wajib menghasilkan `403`. Menu tidak menjadi kontrol keamanan.

Menu **Integrasi Agent** baru tampil setelah tahap Agent A diaktifkan. Fondasi agent-ready pada core tidak mengharuskan menu tersebut terlihat sebelum integration client dapat digunakan dengan aman.

Guru yang memiliki lebih dari satu subject/class scope memperoleh scope switcher. Scope valid disimpan pada URL agar refresh dan back/forward konsisten. Mengganti scope memuat ulang seluruh data yang bergantung pada scope, membersihkan cursor serta selection yang tidak kompatibel, dan meminta confirmation jika editor mempunyai perubahan yang belum disimpan.

---

## 9. Kebutuhan fungsional

Setiap requirement memiliki prioritas:

- **Must:** wajib untuk core MVP atau fondasi correctness.
- **Should:** penting untuk production v1 tetapi dapat dijadwalkan setelah critical path dengan keputusan tertulis.
- **Later:** sengaja setelah core workflow stabil.

### 9.1 Identitas sekolah

| ID | Prioritas | Requirement |
|---|---|---|
| FR-SCH-001 | Must | Sistem menyimpan tepat satu konfigurasi sekolah. |
| FR-SCH-002 | Must | Admin dapat mengelola nama, kode, alamat, dan logo sekolah. |
| FR-SCH-003 | Must | Identitas sekolah tampil konsisten pada login dan shell aplikasi. |
| FR-SCH-004 | Must | Zona waktu UI tetap `Asia/Jakarta` pada baseline. |

### 9.2 Users dan data akademik

| ID | Prioritas | Requirement |
|---|---|---|
| FR-USR-001 | Must | Admin dapat membuat, melihat, memperbarui, menonaktifkan, dan mereset password user. |
| FR-USR-002 | Must | Satu user memiliki satu role utama: `ADMIN`, `TEACHER`, atau `PARTICIPANT`. |
| FR-USR-003 | Must | Username normalized unik secara global. |
| FR-USR-004 | Must | User yang memiliki histori ujian tidak dihapus secara fisik. |
| FR-USR-005 | Must | Menonaktifkan user mencegah login baru dan mencabut session aktif. |
| FR-USR-006 | Must | Admin dapat mengelola tahun ajaran, kelas, roster, mata pelajaran, dan scope guru. |
| FR-USR-007 | Must | Peserta hanya mempunyai satu membership kelas aktif per tahun ajaran pada baseline. |
| FR-USR-008 | Must | Perubahan kelas tidak mengubah snapshot laporan ujian lama. |

#### Import peserta

| ID | Prioritas | Requirement |
|---|---|---|
| FR-IMP-001 | Must | Import menggunakan wizard preview sebelum commit. |
| FR-IMP-002 | Must | Preview membedakan create, unchanged, would-update, duplicate, error, dan blocking error. |
| FR-IMP-003 | Must | Preview hingga 1.500 row memakai server pagination dan filter. |
| FR-IMP-004 | Must | Mode default adalah `create-only`; update existing user menjadi blocking pada mode ini. |
| FR-IMP-005 | Must | Template tidak menerima password plaintext. |
| FR-IMP-006 | Must | Commit membaca normalized preview server-side dan bersifat idempotent. |
| FR-IMP-007 | Must | Credential sementara dibuat saat commit dan hanya tersedia melalui artifact sekali-unduh yang dilindungi re-authentication serta audit. |
| FR-IMP-008 | Must | Preview committed menjadi read-only dan tidak dapat di-commit ulang. |

### 9.3 Authentication dan session login

| ID | Prioritas | Requirement |
|---|---|---|
| FR-AUTH-001 | Must | Admin dan guru login menggunakan username serta password. |
| FR-AUTH-002 | Must | Peserta utama login menggunakan username serta password. |
| FR-AUTH-003 | Must | Tidak ada public registration atau self-service forgot password pada baseline. |
| FR-AUTH-004 | Must | Login menghasilkan opaque HttpOnly session cookie yang state-nya disimpan server. |
| FR-AUTH-005 | Must | State-changing web request dilindungi CSRF dan Origin validation. |
| FR-AUTH-006 | Must | Error login tidak membocorkan keberadaan username. |
| FR-AUTH-007 | Must | Password change/reset mencabut session sesuai policy. |
| FR-AUTH-008 | Must | Admin pertama dibuat melalui one-time CLI, bukan route publik. |
| FR-AUTH-009 | Must | Auth session yang habis saat ujian tidak menghapus outbox; peserta login ulang lalu resume session yang sama bila masih aktif. |
| FR-AUTH-010 | Must | Password peserta memiliki panjang 8–128 karakter dan password staff 12–128 karakter; password tidak boleh sama dengan username normalized. |
| FR-AUTH-011 | Must | Password menerima paste/password manager dan tidak memaksakan komposisi simbol/huruf besar yang kaku. |
| FR-AUTH-012 | Must | Staff session memiliki idle timeout awal sekitar 30 menit dan absolute timeout 8–12 jam; participant auth dapat berlaku selama hari ujian. Nilai final dikonfigurasi dan diuji. |
| FR-AUTH-013 | Must | Reset akun staff atau operasi recovery sensitif memerlukan re-authentication; pemulihan seluruh admin hanya melalui CLI server yang diaudit. |

### 9.4 Bank soal dan revision

| ID | Prioritas | Requirement |
|---|---|---|
| FR-QB-001 | Must | Admin dapat mengakses seluruh bank; guru hanya bank milik atau yang diberikan. |
| FR-QB-002 | Must | Bank terhubung dengan subject dan owner. |
| FR-QB-003 | Must | Bank yang sudah dipakai histori hanya dapat diarsipkan. |
| FR-QB-004 | Must | Soal memiliki logical identity dan revision terpisah. |
| FR-QB-005 | Must | Draft revision dapat diedit; published revision immutable. |
| FR-QB-006 | Must | Mengedit soal published membuat draft revision baru. |
| FR-QB-007 | Must | Validator menghasilkan readiness issues dengan severity, code, field path, message, dan target. |
| FR-QB-008 | Must | Error memblokir publish; warning memerlukan review tetapi tidak memblokir secara default. |
| FR-QB-009 | Must | Participant payload tidak pernah memuat answer key atau explanation. |
| FR-QB-010 | Must | Stimulus opsional pada seluruh tipe soal; bila dipakai dapat memuat teks panjang, gambar, atau keduanya dalam urutan yang ditentukan guru. |
| FR-QB-011 | Must | Setiap opsi pilihan dan pernyataan Benar/Salah dapat memuat teks panjang serta gambar yang terikat tepat pada item dan posisi sisipnya. |

### 9.5 Tipe soal dan scoring

| Tipe | Struktur wajib | Jawaban peserta | Kondisi benar |
|---|---|---|---|
| `SINGLE_CHOICE` | Stimulus opsional, pertanyaan, 2–10 opsi | Tepat satu option ID | Pilihan sama dengan satu-satunya key |
| `MULTIPLE_RESPONSE` | Stimulus opsional, pertanyaan, 2–10 opsi | Satu atau lebih option ID unik | Himpunan pilihan sama persis dengan seluruh key |
| `TRUE_FALSE` | Stimulus opsional dan tepat 3 pernyataan | Boolean untuk setiap pernyataan | Ketiga nilai tepat |

Aturan produk:

- ketiga tipe memakai exact-match scoring;
- tidak ada partial score;
- jawaban kosong atau tidak lengkap bernilai nol;
- duplicate/foreign option atau statement ID ditolak;
- bobot benar diberikan penuh, selain itu nol;
- urutan pilihan multiple response tidak memengaruhi hasil.

### 9.6 Media soal

| ID | Prioritas | Requirement |
|---|---|---|
| FR-MED-001 | Must | Upload hanya menerima JPEG, PNG, dan WebP pada baseline. |
| FR-MED-002 | Must | Batas awal adalah 2 MiB dan 2.500 × 2.500 pixel. |
| FR-MED-003 | Must | Media informatif wajib mempunyai alt text; media dekoratif ditandai eksplisit. |
| FR-MED-004 | Must | Asset yang direferensikan revision published tidak dapat dihapus. |
| FR-MED-005 | Must | UI menampilkan preview, progress, retry, serta error type/size/dimension/network. |
| FR-MED-006 | Must | Media tidak disimpan sebagai base64 di payload soal. |
| FR-MED-007 | Must | Gambar dapat ditempelkan pada stimulus, prompt, penjelasan, opsi tertentu, atau pernyataan tertentu; participant payload mempertahankan target dan urutan sisipnya di antara teks. |
| FR-MED-008 | Must | Import CSV membawa teks saja. Gambar tidak menerima URL eksternal, placeholder media, atau base64 dan ditempelkan ke draft melalui editor sesudah import. |

### 9.7 Exam authoring

| ID | Prioritas | Requirement |
|---|---|---|
| FR-EXM-001 | Must | Exam memiliki logical identity dan draft/published revision. |
| FR-EXM-002 | Must | Draft memuat judul, instruksi, durasi, randomization, daftar revision soal, posisi, dan bobot. |
| FR-EXM-003 | Must | Satu revision soal hanya muncul sekali dalam satu exam revision. |
| FR-EXM-004 | Must | Exam minimal memiliki satu published question revision. |
| FR-EXM-005 | Must | Total score dihitung deterministik ketika publish. |
| FR-EXM-006 | Must | Published exam revision immutable. |
| FR-EXM-007 | Must | Publish selalu menjalankan validator server terbaru. |
| FR-EXM-008 | Must | Question picker mendukung search/filter/pagination, selected tray, duplicate prevention, dan keyboard reorder. |

### 9.8 Jadwal ujian

| ID | Prioritas | Requirement |
|---|---|---|
| FR-SCHD-001 | Must | Jadwal menunjuk satu immutable exam revision. |
| FR-SCHD-002 | Must | Jadwal mempunyai mode `MAIN` atau `PRACTICE`. |
| FR-SCHD-003 | Must | Jadwal menentukan window, duration, hard end, target, attempt policy, dan result policy. |
| FR-SCHD-004 | Must | MAIN menargetkan kelas dan/atau participant account. |
| FR-SCHD-005 | Must | PRACTICE memakai token dan konfigurasi identity fields. |
| FR-SCHD-006 | Must | Token practice dan kode MAIN plaintext hanya ditampilkan saat dibuat atau dirotasi; kunjungan berikutnya hanya menampilkan hint. |
| FR-SCHD-007 | Must | Perubahan material setelah ada session dibatasi dan diaudit. |
| FR-SCHD-008 | Must | Menutup jadwal menolak start/save baru dan memfinalisasi session aktif dari answer committed. |
| FR-SCHD-009 | Must | Kode akses memakai tepat lima karakter uppercase/digit dari alfabet tanpa `I`, `L`, `O`, `0`, `1`; lowercase dinormalisasi uppercase dan hyphen diabaikan. |
| FR-SCHD-010 | Must | MAIN tetap mewajibkan login username/password dan eligibility; kode MAIN hanya lapisan tambahan untuk memilih schedule. |
| FR-SCHD-011 | Must | Guru dapat menerima kode server atau mengusulkan kode sendiri; server menormalisasi, menolak collision, menyimpan digest, dan menyediakan rotasi. |

#### Lifecycle jadwal

```text
DRAFT -> READY -> OPEN -> CLOSED -> ARCHIVED
```

- `DRAFT`: belum valid atau belum siap diakses.
- `READY`: valid dan menunggu waktu.
- `OPEN`: dapat diakses peserta eligible dalam window.
- `CLOSED`: tidak menerima start/save baru.
- `ARCHIVED`: histori read-only.

### 9.9 Lifecycle ujian

```text
DRAFT -> PUBLISHED -> SCHEDULED -> ACTIVE -> FINISHED -> ARCHIVED
```

| State | Makna produk |
|---|---|
| Draft | Konten dapat diedit dan belum dapat dikerjakan. |
| Published | Revision immutable telah terbentuk. |
| Scheduled | Target dan waktu akses tersedia. |
| Active | Peserta eligible dapat start/resume. |
| Finished | Start/save baru ditolak; result difinalisasi. |
| Archived | Read-only dan tidak tampil pada daftar operasional utama. |

Eligibility selalu memakai schedule, waktu server, target, dan attempt aktual; lifecycle display saja tidak cukup untuk memberi akses.

### 9.10 Akses latihan

| ID | Prioritas | Requirement |
|---|---|---|
| FR-PRC-001 | Must | Peserta memasukkan token sebelum form identitas ditampilkan. |
| FR-PRC-002 | Must | Error token tidak membedakan token tidak ada, expired, atau schedule closed. |
| FR-PRC-003 | Must | Nama wajib 1–200 karakter Unicode setelah trim. |
| FR-PRC-004 | Must | Instansi, kelas, dan field tambahan mengikuti konfigurasi server. |
| FR-PRC-005 | Must | Identity snapshot tidak dapat diedit setelah session dibuat. |
| FR-PRC-006 | Must | Practice credential hanya dapat membuka satu session tamu. |
| FR-PRC-007 | Must | Refresh/resume dijamin pada browser yang masih memiliki cookie practice. |
| FR-PRC-008 | Must | Token dan identity tidak disimpan di localStorage. |

### 9.11 Dashboard dan eligibility peserta utama

| ID | Prioritas | Requirement |
|---|---|---|
| FR-ELG-001 | Must | Dashboard menampilkan ujian berlangsung, akan datang, selesai, dan hasil tersedia. |
| FR-ELG-002 | Must | CTA ditentukan server: Mulai, Lanjutkan, Belum Dimulai, atau Lihat Hasil. |
| FR-ELG-003 | Must | Setelah attempt terpakai, start kedua ditolak kecuali ada reset grant resmi. |
| FR-ELG-004 | Must | Reset menampilkan badge “Attempt baru tersedia” dan mengaktifkan tombol Mulai Ujian. |
| FR-ELG-005 | Must | Badge reset hilang hanya setelah replacement session berhasil dibuat. |

### 9.12 Monitoring dan operasi staf

| ID | Prioritas | Requirement |
|---|---|---|
| FR-MON-001 | Must | Monitoring menampilkan aggregate target, belum mulai, active, submitted, dan expired. |
| FR-MON-002 | Must | Session list memakai cursor pagination, filter, search, dan sort server-side. |
| FR-MON-003 | Must | Jadwal >200 peserta tidak menyediakan “Tampilkan semua”. |
| FR-MON-004 | Must | Polling default 15 detik dengan jitter ±3 detik dan berhenti ketika tab hidden. |
| FR-MON-005 | Must | UI dapat pause/resume polling dan menunjukkan usia data serta stale state. |
| FR-MON-006 | Must | Detail session menampilkan progress dan waktu tanpa raw answer, answer key, IP mentah, atau device fingerprint. |
| FR-MON-007 | Must | Last activity tidak boleh diberi label “Online”. |

#### Perpanjang Waktu

- hanya untuk session aktif dan actor berwenang;
- menit harus positif dan tidak boleh memendekkan deadline;
- alasan wajib maksimal 500 karakter;
- UI menampilkan deadline lama serta baru;
- peserta menerima deadline authoritative terbaru melalui save/resume berikutnya;
- seluruh perubahan diaudit.

#### Akhiri Sesi

- hanya menargetkan satu session aktif;
- alasan wajib maksimal 500 karakter;
- hanya answer yang sudah committed yang dinilai;
- pending outbox pada perangkat tidak dapat diambil staf;
- hasil mengikuti release policy normal;
- tidak otomatis memberikan attempt baru.

#### Tutup Jadwal

- menargetkan seluruh schedule;
- confirmation menampilkan jumlah session aktif yang terdampak;
- menolak start/save baru setelah close committed;
- session aktif difinalisasi bertahap dari answer committed;
- action dan finalization cause diaudit.

#### Reset attempt

- admin-only pada baseline;
- histori session, answer, result, dan audit lama dipertahankan;
- session aktif difinalisasi dengan `RESET_ATTEMPT`;
- session yang sudah final tidak kehilangan alasan finalisasi aslinya;
- satu grant membuat tepat satu replacement session;
- lebih dari satu grant belum terpakai untuk peserta/schedule yang sama ditolak.

### 9.13 Results, release, dan export

| ID | Prioritas | Requirement |
|---|---|---|
| FR-RES-001 | Must | Setiap final session menghasilkan maksimal satu result. |
| FR-RES-002 | Must | Result menyimpan score, max score, percentage, benar, salah, kosong, dan waktu scoring. |
| FR-RES-003 | Must | Percentage memakai pembulatan round-half-up dua digit desimal. |
| FR-RES-004 | Must | Hasil utama hanya terlihat peserta setelah `released_at` tersedia. |
| FR-RES-005 | Must | Guru/admin dapat release selected results atau seluruh hasil sesuai filter/scope snapshot. |
| FR-RES-006 | Must | Unrelease menyembunyikan hasil pada request berikutnya tanpa mengubah score. |
| FR-RES-007 | Must | UI menjelaskan bahwa informasi yang sudah dilihat tidak dapat ditarik kembali. |
| FR-RES-008 | Must | Hasil latihan menampilkan skor dan aggregate benar/salah/kosong tanpa answer key. |
| FR-RES-009 | Must | Retry latihan mengikuti `canRetry` dan `canRetryReason` dari server. |
| FR-EXP-001 | Must | Export berjalan sebagai job `QUEUED`, `RUNNING`, `READY`, `FAILED`, atau `EXPIRED`. |
| FR-EXP-002 | Must | Export memakai filter/scope snapshot dan tidak memblokir halaman. |
| FR-EXP-003 | Must | File hanya dapat diunduh setelah authorization dan download berhasil diaudit. |
| FR-EXP-004 | Must | File expired tidak dapat digunakan kembali; user membuat ulang job. |
| FR-EXP-005 | Must | CSV adalah format resmi baseline; print browser bukan jalur resmi. |

### 9.14 Audit

| ID | Prioritas | Requirement |
|---|---|---|
| FR-AUD-001 | Must | Audit bersifat append-only melalui aplikasi normal. |
| FR-AUD-002 | Must | Audit mencatat actor, action, entity, request ID, waktu, outcome, serta metadata aman. |
| FR-AUD-003 | Must | Password, token, cookie, answer key, raw answer, dan PII tak perlu harus di-redact atau tidak dicatat. |
| FR-AUD-004 | Must | Autosave tidak membuat audit row umum per jawaban. |
| FR-AUD-005 | Must | Admin dapat mencari audit berdasarkan actor, action, entity, tanggal, dan request ID. |
| FR-AUD-006 | Must | Detail audit merender JSON sebagai escaped read-only data, bukan HTML. |

---

## 10. Arsitektur produk exam session

Bagian ini adalah kontrak perilaku produk paling kritis.

### 10.1 Memulai ujian

1. Client memperoleh eligibility authoritative.
2. Peserta menekan Mulai Ujian.
3. Client mengirim start idempotency key yang stabil sampai outcome diketahui.
4. Server memvalidasi user/token, target, schedule, waktu, dan attempt.
5. Server membuat session serta manifest soal secara atomik.
6. Server mengembalikan `sessionId`, waktu mulai, deadline, server time, manifest aman, dan jawaban existing bila resume.

Kriteria penerimaan:

- double-click tidak membuat dua session;
- response yang hilang dapat diulang dengan key sama dan memperoleh session sama;
- dua key berbeda tidak dapat melanggar attempt policy;
- UI menampilkan “Periksa status” setelah start terlalu lama, bukan membuat start baru;
- answer key tidak berada dalam manifest peserta.

### 10.2 Timer

- deadline server adalah sumber kebenaran;
- deadline dihitung sebagai nilai minimum antara waktu mulai + durasi dan akhir keras schedule;
- mengubah jam perangkat tidak mengubah waktu ujian;
- save diterima hanya sebelum deadline berdasarkan waktu database;
- tidak ada grace period tersembunyi;
- UI mengoreksi offset dari `serverNow`.

### 10.3 Manifest soal

Session membekukan:

- exam revision;
- question revisions;
- urutan soal;
- urutan opsi choice bila diacak;
- urutan tiga pernyataan true/false tetap;
- bobot setiap soal.

Refresh dan resume wajib menampilkan manifest yang sama.

### 10.4 Menyimpan jawaban

- perubahan jawaban masuk UI dan IndexedDB terlebih dahulu;
- save berjalan change-driven, debounced, batched, dan berjitter;
- satu batch maksimal 20 jawaban;
- setiap jawaban membawa base version;
- server mengembalikan `SAVED`, `UNCHANGED`, atau `CONFLICT` per item;
- versi berbeda dengan payload sama dianggap unchanged;
- versi berbeda dengan payload berbeda menghasilkan state authoritative untuk rekonsiliasi;
- UI menghapus mutation lokal hanya setelah acknowledgment.

### 10.5 Offline dan resume

Saat offline:

- soal yang telah diunduh tetap dapat dibaca;
- jawaban baru tetap masuk outbox;
- UI menyatakan jawaban aman di perangkat tetapi belum tersimpan server;
- retry memakai backoff;
- reconnect memuat state authoritative dan mengirim kembali mutation yang masih relevan.

Browser boleh menyimpan manifest yang dapat dilihat, deadline tampilan, snapshot jawaban, outbox, posisi navigasi, dan idempotency key di IndexedDB. Browser tidak boleh menyimpan password, cookie value, raw practice token, raw MAIN access code, permission authoritative, atau answer key.

### 10.6 Submit

- submit membawa pending `finalAnswers` beserta base version;
- submit adalah final sync dan finalisasi dalam satu transaksi;
- client tidak menunggu sync request terpisah;
- session dikunci sebelum final answer dan scoring;
- save setelah final ditolak;
- submit berulang mengembalikan final state yang sama;
- tepat satu result dibuat.

Failure handling:

| Kondisi | Perilaku produk |
|---|---|
| Network/response hilang | Pertahankan outbox, periksa state, retry key/payload sama bila masih active |
| `503` | Hormati `Retry-After`, backoff, dan sediakan Coba Lagi |
| Answer conflict sebelum deadline | Jangan finalisasi; tampilkan state authoritative dan minta rekonsiliasi |
| Auth expired | Login ulang tanpa menghapus outbox, lalu resume |
| Session sudah final | Hentikan retry dan tampilkan final state |
| Deadline lewat | Nilai answer terakhir yang telah committed server |
| Validation error | Jangan retry otomatis; tampilkan error yang dapat ditindaklanjuti |

### 10.7 Timeout

- browser meminta finalisasi saat timer nol;
- server tetap menolak save yang terlambat walaupun background job belum berjalan;
- timeout worker memproses batch kecil secara idempotent;
- result page boleh memicu finalisasi idempotent;
- keterlambatan worker tidak memperpanjang deadline.

### 10.8 Status dan alasan finalisasi

```text
ACTIVE -> SUBMITTED -> SCORED
ACTIVE -> EXPIRED   -> SCORED
ACTIVE -> ENDED     -> SCORED
```

| Alasan | Label UI |
|---|---|
| `PARTICIPANT_SUBMIT` | Dikumpulkan |
| `DEADLINE` | Waktu Habis |
| `STAFF_END` | Diakhiri Petugas |
| `SCHEDULE_CLOSE` | Jadwal Ditutup |
| `RESET_ATTEMPT` | Attempt Direset |

Alasan finalisasi bersifat write-once. Label finalisasi tidak menyatakan hasil telah dirilis.

### 10.9 Multi-tab dan multi-device

- client memberi warning melalui `BroadcastChannel` bila session yang sama terbuka di tab lain;
- server tidak memakai distributed device lock pada baseline;
- optimistic version menyelesaikan persaingan jawaban;
- peserta utama dapat resume pada perangkat lain setelah login;
- peserta latihan hanya dijamin resume pada browser yang memiliki credential practice.

---

## 11. External AI agent requirements

### 11.1 Boundary produk

- Hivekeep/Hermes, Telegram/WhatsApp, LLM, memory, prompt, dan conversation loop berada di luar GezyCBT.
- GezyCBT tidak menyimpan credential channel.
- Agent tidak mendapat akses MariaDB, SQL, shell, filesystem, backup key, atau application secret.
- REST/OpenAPI adalah kontrak canonical; MCP bridge opsional berada di sisi agent.

### 11.2 Integration client

- owner dapat admin atau guru;
- scope client guru tidak boleh melebihi scope owner;
- credential minimal 256 bit, disimpan sebagai digest, dan plaintext tampil sekali;
- owner disabled menonaktifkan client/credential dan membatalkan pending action;
- reaktivasi owner tidak otomatis mengaktifkan client;
- full-application grant diekspansi menjadi capability eksplisit;
- capability yang ditambahkan pada release baru tidak otomatis masuk grant lama.

### 11.3 Capability penting

- question bank dan soal;
- `questions.read_key` terpisah dari `questions.read`;
- media upload;
- exam authoring dan attach questions;
- schedule serta session monitoring;
- `sessions.end` terpisah dari `schedules.close`;
- results utama dan `results.read_practice`;
- export;
- audit read;
- allowlisted school settings.

Agent tidak dapat mengubah integration client, credential, grant, audit, secret, atau server settings melalui Agent Integration API.

### 11.4 Risk dan approval

| Level | Contoh | Perilaku |
|---|---|---|
| R0 | Search, list, summary | Langsung |
| R1 | Buat/ubah draft | Langsung hanya jika `auto_approve_r1=true` |
| R2 | Bulk attach, publish, export | Prepare lalu confirm |
| R3 | Close schedule, end session, reset attempt, release result, disable user, export PII | Web approval atau konfirmasi kuat |
| R4 | Self-grant, SQL, shell, secret, audit delete | Selalu ditolak |

Exact action plan minimal memuat capability, target stable ID, expected version/state, parameter immutable, before/after aman, impact count, risk, client/owner, grant version, dan expiry. Confirm hanya menerima action ID serta plan hash, lalu server memeriksa ulang grant, scope, expiry, dan target version.

### 11.5 Agent offline dan polling

- GezyCBT tidak mengirim webhook ke agent;
- agent memeriksa status dengan polling serta backoff;
- agent dapat mengambil action pending miliknya setelah reconnect;
- action pending expired setelah 30 menit secara default;
- action expired tidak dapat dikonfirmasi dan harus dipersiapkan ulang;
- polling biasa tidak membuat audit row per request.

### 11.6 Agent acceptance

- retry mutation tidak membuat data ganda;
- revoke berlaku pada request berikutnya;
- ambiguous search tidak auto-select bila kandidat lebih dari satu;
- ordinary question read tidak membocorkan key;
- sensitive key/result read diaudit;
- download token berlaku maksimal 5 menit dan sekali pakai;
- agent outage tidak mengganggu web CBT;
- agent traffic tidak membuat SLO ujian gagal.

---

## 12. UI/UX requirements

### 12.1 Arah visual

- tenang, jelas, akademis, modern, dan tidak ramai;
- primary biru, sidebar staff navy, canvas netral;
- system font tanpa font eksternal;
- desain menggunakan tokens;
- dark mode tersedia pada seluruh halaman;
- pilihan theme: System, Terang, Gelap;
- default pengguna baru mengikuti sistem.

### 12.2 Responsive

- minimum viewport 360 px;
- tidak ada horizontal page scroll;
- form dua kolom berubah satu kolom di bawah 768 px;
- halaman ujian tidak memakai sidebar/footer;
- ponsel memakai palette drawer dan bottom navigation sticky;
- desktop memakai content utama dan palette samping;
- orientasi atau theme change tidak menghapus state.

### 12.3 Halaman ujian

Komponen wajib:

- progress soal;
- timer;
- connectivity serta save status;
- stimulus/media;
- semantic renderer tiga tipe soal;
- Tandai Soal;
- Sebelumnya/Berikutnya;
- palette dengan belum dijawab/sudah dijawab/ditandai;
- submit summary;
- offline/reconnect banner.

Save state yang terlihat: Tersimpan, Belum tersimpan, Menyimpan, Offline—tersimpan di perangkat, Perlu sinkronisasi, Mengumpulkan, dan Sesi diakhiri.

### 12.4 Theme

- preference non-sensitif boleh disimpan di localStorage;
- theme bootstrap memakai external first-party hashed script;
- tidak memerlukan inline script atau `unsafe-inline`;
- media tidak di-invert;
- theme change tidak mengubah focus, jawaban, outbox, timer, atau form.

### 12.5 Accessibility

- target flow kritis adalah WCAG 2.2 AA;
- peserta/mobile memakai touch target minimal 44 × 44 px;
- semua action penting dapat digunakan keyboard;
- focus ring wajib terlihat;
- navigasi soal memindahkan focus ke heading “Soal N dari M” tanpa memilih jawaban;
- modal/drawer melakukan focus trap dan mengembalikan focus ke trigger;
- error form memindahkan focus ke summary atau field pertama;
- toast tidak memindahkan focus;
- status tidak bergantung pada warna;
- timer tidak diumumkan setiap detik;
- offline dan threshold waktu diumumkan satu kali serta di-dedup;
- reduced motion dan zoom 200% tidak menghilangkan fungsi.

### 12.6 Error boundary

- kegagalan widget tidak menjatuhkan seluruh route;
- renderer soal dipisahkan dari timer, navigation, connectivity, dan outbox;
- error renderer tidak menghapus jawaban lokal;
- recovery membaca ulang session authoritative;
- telemetry tidak memuat soal, jawaban, token, atau identitas.

### 12.7 Bahasa

- bahasa utama adalah Bahasa Indonesia;
- label memakai kata kerja spesifik;
- tanggal/waktu memakai format Indonesia dan WIB;
- enum internal diterjemahkan ke istilah pengguna;
- confirmation menyebut target, jumlah terdampak, akibat, dan kemampuan pembatalan.

---

## 13. Nonfunctional requirements

### 13.1 Reliability dan correctness

| ID | Requirement |
|---|---|
| NFR-REL-001 | State penting wajib tersimpan di MariaDB, bukan hanya memory process. |
| NFR-REL-002 | Seluruh mutation kritis idempotent atau dilindungi version/unique constraint. |
| NFR-REL-003 | Session, answer, result, dan audit bertahan setelah restart API. |
| NFR-REL-004 | Setiap final session mempunyai maksimal satu result. |
| NFR-REL-005 | Seluruh race kritis diuji dengan minimal dua database connection nyata. |
| NFR-REL-006 | Background job idempotent dan tidak menjadi sumber correctness tunggal. |

### 13.2 Performance dan capacity

| ID | Requirement |
|---|---|
| NFR-PERF-001 | Load test mencakup 1.000 peserta, 100 soal, media representatif, autosave berjitter, submit, dan timeout. |
| NFR-PERF-002 | API memakai pool database kecil dan bounded queue. |
| NFR-PERF-003 | Report/export/agent diturunkan prioritasnya saat exam load tinggi. |
| NFR-PERF-004 | Tabel besar menggunakan pagination server-side. |
| NFR-PERF-005 | Export streaming/job tidak membangun seluruh file di memory. |
| NFR-PERF-006 | Bundle peserta tidak memuat editor, admin table, atau chart yang tidak diperlukan. |
| NFR-PERF-007 | Tidak ada media base64 atau `ORDER BY RAND()` pada critical path. |

### 13.3 Security

| ID | Requirement |
|---|---|
| NFR-SEC-001 | HTTPS wajib dan cookie memakai Secure, HttpOnly, serta SameSite yang sesuai. |
| NFR-SEC-002 | Password memakai Argon2id dengan bounded concurrency. |
| NFR-SEC-003 | Semua query memakai parameter binding dan sort/filter allowlist. |
| NFR-SEC-004 | Semua resource read/write memeriksa role, ownership, dan scope. |
| NFR-SEC-005 | Rich text disanitasi server-side dan dilindungi CSP. |
| NFR-SEC-006 | Secret, token, answer, dan key tidak masuk log. |
| NFR-SEC-007 | Media disimpan di luar public webroot dan dilayani setelah authorization. |
| NFR-SEC-008 | Private API memakai `Cache-Control: no-store`, kecuali media private cache yang disengaja. |
| NFR-SEC-009 | Negative leakage contract tests wajib tersedia. |

### 13.4 Maintainability

- modular monolith dalam satu repository Bun workspaces;
- TypeScript strict;
- shared contracts tidak berisi entity database atau business rule;
- route tidak mengandung SQL atau domain rule;
- migration forward-only dengan checksum;
- exact dependency versions serta lockfile;
- OpenAPI dihasilkan dari schema yang sama;
- query penting diberi nama dan dapat dianalisis;
- perubahan keputusan lintas domain dicatat melalui ADR.

### 13.5 Compatibility

- Bun, Elysia, Vue, dan MariaDB harus dipin ke versi yang diuji;
- Bun.SQL wajib lulus compatibility spike sebelum dipilih;
- official MariaDB Connector/Node.js menjadi fallback;
- Chrome Android, Safari iOS yang digunakan sekolah, serta Chrome/Edge desktop diuji sebelum pilot;
- Hivekeep/Hermes dipilih melalui integration spike, bukan asumsi dokumentasi.

### 13.6 Backup dan recovery

| Requirement | Baseline |
|---|---:|
| RPO periode ujian | Maksimal 15 menit bila binary log disetujui |
| RPO di luar ujian | Maksimal 24 jam |
| RTO | 2 jam pada VPS pengganti |
| Full backup | Harian, retensi 7 hari |
| Weekly backup | Retensi 4 minggu |
| Restore drill | Minimal kuartalan dan sebelum musim ujian besar |

Backup database dan media wajib disimpan di luar VPS serta dienkripsi.

---

## 14. Rate limiting baseline

| Scope | Baseline awal |
|---|---:|
| Kegagalan login per username | 5/15 menit |
| Kegagalan participant login per IP | 300/15 menit |
| Invalid practice token atau MAIN access code per IP | 30/10 menit |
| Start per actor/session | 10/menit |
| Autosave per exam session | 60/menit, burst 20 |
| Submit per exam session | 5/menit |
| Upload per staff | 20/menit |
| Export per staff | 3/10 menit, satu aktif |
| Agent read per client | 60/menit |
| Agent mutation per client | 20/menit |
| Agent export per client | 3/10 menit, satu aktif |
| Agent auth failure | 5/15 menit |

Nilai wajib dituning melalui simulasi NAT sekolah dan load test. Response rate limit memakai `429` serta `Retry-After`.

---

## 15. Data, privacy, dan retention

### 15.1 Klasifikasi

| Kelas | Contoh |
|---|---|
| Secret | Password, raw session token, practice token, integration credential |
| Exam confidential | Answer key, unpublished question, explanation |
| Personal data | Nama, username, kelas, instansi, IP-derived telemetry |
| Exam record | Answer, attempt, deadline, score |
| Public/static | Hashed JS/CSS dan asset publik |

### 15.2 Retention baseline

- auth session expired: 30 hari;
- auth throttle: 30 hari tanpa aktivitas;
- uncommitted import preview: maksimal 24 jam setelah expiry;
- committed import row detail/token: dibersihkan segera; safe summary 30 hari;
- audit: minimal 1 tahun;
- agent action detail: minimal 90 hari, audit summary tetap mengikuti audit retention;
- exam session, answer, dan result: tidak dipurge pada versi awal;
- orphan draft media: dapat dibersihkan setelah 7 hari;
- export file: memiliki expiry dan tidak menjadi archive permanen.

Practice form hanya meminta identitas yang dibutuhkan. Nama yang sama tidak dianggap sebagai identity key unik.

---

## 16. Acceptance scenarios lintas fitur

### AC-01 — Membuat dan menerbitkan soal

**Given** guru berada dalam subject scope,  
**When** guru membuat draft salah satu dari tiga tipe dan seluruh aturan valid,  
**Then** revision dapat dipublish, menjadi immutable, dan dapat dipilih pada exam draft.

### AC-02 — Menolak soal tidak valid

**Given** draft mempunyai kunci/opsi/pernyataan yang tidak memenuhi aturan,  
**When** guru menjalankan validation atau publish,  
**Then** server mengembalikan readiness errors yang tertaut ke field dan publish ditolak.

### AC-03 — Satu attempt ujian utama

**Given** peserta eligible menekan mulai dari dua request bersamaan,  
**When** start diproses,  
**Then** hanya satu session/attempt terbentuk dan kedua outcome tidak melanggar P-02.

### AC-04 — Autosave dan refresh

**Given** peserta telah menerima acknowledgment untuk beberapa jawaban dan mempunyai outbox lain,  
**When** halaman direfresh,  
**Then** state server dimuat, outbox lokal direkonsiliasi, dan jawaban acknowledged tidak hilang.

### AC-05 — Offline

**Given** session aktif dan manifest telah diunduh,  
**When** jaringan terputus,  
**Then** peserta tetap dapat menjawab, UI tidak mengklaim tersimpan server, dan jawaban dikirim setelah reconnect.

### AC-06 — Submit dengan pending answer

**Given** outbox masih mempunyai jawaban belum acknowledged,  
**When** peserta submit sebelum deadline,  
**Then** pending answer dikirim sebagai final answers dan scoring/finalisasi commit atomik.

### AC-07 — Response submit hilang

**Given** server mungkin telah commit tetapi response hilang,  
**When** client memeriksa session dan retry,  
**Then** tidak ada result kedua dan final state yang sama dikembalikan.

### AC-08 — Timeout

**Given** deadline telah lewat,  
**When** browser atau worker memicu finalisasi,  
**Then** answer baru ditolak dan result memakai answer terakhir yang committed.

### AC-09 — Reset attempt

**Given** admin mereset attempt dengan alasan,  
**When** peserta membuka dashboard dan memulai kembali,  
**Then** satu reset grant dikonsumsi oleh tepat satu replacement session dan histori lama tetap ada.

### AC-10 — Tutup Jadwal

**Given** schedule mempunyai session aktif,  
**When** guru berwenang menutup jadwal setelah impact confirmation,  
**Then** start/save baru ditolak, session aktif difinalisasi, dan reason `SCHEDULE_CLOSE` tercatat.

### AC-11 — Rilis hasil utama

**Given** result utama sudah scored tetapi belum dirilis,  
**When** guru merilis subset yang dipilih,  
**Then** hanya result target yang terlihat peserta dan outcome partial terlihat jelas.

### AC-12 — Hasil latihan

**Given** peserta latihan telah final,  
**When** halaman hasil dibuka,  
**Then** score dan aggregate ditampilkan tanpa key/correctness per soal serta CTA retry mengikuti server.

### AC-13 — Scope guru

**Given** guru mencoba deep link atau API resource di luar scope,  
**When** request dikirim,  
**Then** backend menolak dengan `403` walaupun UI dimanipulasi.

### AC-14 — Agent mutation retry

**Given** integration client mempunyai grant yang sesuai,  
**When** mutation diulang dengan idempotency key dan payload sama,  
**Then** server mengembalikan outcome yang sama tanpa mutasi ganda.

### AC-15 — Agent high-risk action

**Given** agent mempersiapkan tindakan R3,  
**When** target/grant/version berubah sebelum approval,  
**Then** confirm ditolak dan exact plan baru harus dibuat.

### AC-16 — Dark mode dan accessibility

**Given** pengguna memilih System, Terang, atau Gelap,  
**When** theme berubah pada flow kritis,  
**Then** state, focus, timer, form, dan jawaban tidak berubah serta kontras tetap memenuhi baseline.

### AC-17 — Beban 1.000 peserta

**Given** dataset dan skenario produksi representatif,  
**When** load serta soak test dijalankan,  
**Then** target latency/error tercapai, tidak ada acknowledged loss/result ganda, dan memory/pool pulih setelah spike.

### AC-18 — Restore

**Given** backup production-like,  
**When** restore dilakukan ke server kosong,  
**Then** database, media, migration state, dan smoke test tiga role berhasil dalam target RTO.

---

## 17. Testing dan quality gates

### 17.1 Unit

- lifecycle dan eligibility;
- exact-match scorer tiga tipe;
- randomization deterministik;
- deadline serta attempt policy;
- role/ownership/scope;
- risk classifier dan plan hash agent.

### 17.2 Integration dengan MariaDB asli

- foreign key/unique/check constraint;
- publish immutability;
- concurrent start/save/submit/timeout;
- reset grant race;
- import idempotency;
- result release/unrelease;
- media reference protection;
- media stimulus/opsi/pernyataan tetap terkait target yang tepat pada revision immutable;
- auth/session expiry/revoke;
- agent credential/grant/approval/export.

### 17.3 Contract

- frontend/backend schema konsisten;
- participant response bebas answer key dan internal fields;
- monitoring bebas raw answer/device fingerprint;
- import error bebas credential;
- practice result bebas correctness per soal;
- agent ordinary read bebas answer key;
- OpenAPI snapshot berubah hanya melalui review.

### 17.4 E2E

- admin dari bootstrap sampai import peserta;
- guru dari soal sampai jadwal serta export;
- peserta utama dan latihan;
- offline, refresh, multi-tab, auth expiry, timeout;
- extension, end session, close schedule, reset attempt;
- light/dark/system;
- stimulus kosong, stimulus teks panjang, serta gambar pada stimulus/opsi/pernyataan;
- mobile/tablet/desktop;
- keyboard dan screen-reader smoke test.

### 17.5 Release gate

Rilis tidak boleh dilanjutkan bila terdapat:

- failing correctness/security test;
- migration yang belum diuji dari snapshot sebelumnya;
- participant leakage test gagal;
- restore belum pernah diuji;
- high-severity issue terbuka;
- load test critical path belum mencapai baseline yang disetujui;
- dependency/runtime version belum dipin.

---

## 18. Tahapan delivery produk

| Fase | Deliverable produk | Exit gate |
|---:|---|---|
| 0 | PRD, keputusan produk, compatibility spike, ADR | Tidak ada keputusan schema-critical implisit |
| 1 | Repository, CI, API/web shell, contracts, migration runner | Clean checkout dapat install, migrate, test, build, start |
| 2 | Master data dan import | Constraint dan integration test lulus |
| 3 | Auth dan authorization | Negative security tests lulus |
| 4 | Bank soal tiga tipe dan media | Publish, immutability, scorer lulus |
| 5 | Exam authoring dan schedule | Flow draft sampai READY lulus |
| 6 | Exam runtime backend | Race, retry, timeout, no-loss lulus |
| 7 | Participant UI | Mobile/offline/resume E2E lulus |
| 8 | Staff UI, result, export, audit | Workflow web end-to-end lengkap |
| 8B | Agent bertahap | Credential/grant/idempotency/audit/tool tests lulus |
| 9 | Security dan operasi | Restore, runbook, headers, redaction lulus |
| 10 | Performance | Load/soak memenuhi target dengan headroom |
| 11 | Pilot 30–100 peserta | Temuan tinggi ditutup |
| 12 | Production | Go-live checklist dan reconciliation lulus |

---

## 19. Risiko produk dan mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| VPS tunggal gagal | Seluruh layanan berhenti | Offsite backup, restore drill, monitoring, runbook |
| Start serentak | Spike DB/CPU | Login lebih awal, idempotency, bulk insert, bounded hashing |
| Jaringan peserta buruk | Jawaban tertunda | IndexedDB outbox, visible state, retry/backoff |
| Double request | Session/result ganda | Row lock, unique constraint, idempotency |
| Dua tab/perangkat | Jawaban konflik | Base version, authoritative response, warning |
| Timer client dimanipulasi | Durasi tidak adil | Database time dan server deadline |
| Key bocor | Integritas ujian rusak | DTO terpisah dan negative contract test |
| Report/export berat | Autosave lambat | Resource priority, pagination, worker concurrency kecil |
| Media berbahaya | XSS/storage abuse | Magic bytes, allowlist, size/dimension limit, private storage |
| RAM 2 GB habis | Restart/OOM | Pool kecil, bounded queue, memory budget, soak test |
| Disk lambat/penuh | Transaction gagal | SSD/NVMe, alert, reject upload/export lebih dahulu |
| Backup tidak dapat direstore | Kehilangan data | Automated verification dan restore drill |
| Exact match tidak dipahami | Peserta merasa hasil salah | Instruksi eksplisit dan preview guru |
| Practice token dibagikan | Identitas tidak terverifikasi | Rotation, expiry, attempt policy, guest labeling |
| Agent salah target | Mutasi keliru | Stable ID, ambiguity handling, exact plan, approval |
| Credential agent bocor | Akses tanpa izin | Vault, expiry, revoke, grant, audit, kill switch |
| Agent membebani VPS | Ujian melambat | Rate limit, backpressure, defer export, load isolation |

---

## 20. Dependency dan keputusan sebelum coding fitur domain

### 20.1 Wajib pada Fase 0

1. Menetapkan versi exact Bun, Elysia, Vue, Vite, TypeScript, dan MariaDB.
2. Menjalankan compatibility spike Bun.SQL terhadap MariaDB production target — selesai pada `ISS-003`.
3. Membuat ADR-003 berdasarkan hasil spike untuk memilih Bun.SQL atau MariaDB Connector — selesai pada `ISS-004`.
4. Menetapkan browser/device support final sekolah — baseline default diterima pada [`08-OPERATING-BASELINE.md`](./08-OPERATING-BASELINE.md); verifikasi perangkat nyata dilakukan saat pilot.
5. Mengkonfirmasi batas jumlah soal, durasi maksimum, manifest, serta media dari data nyata sekolah — baseline default diterima pada [`08-OPERATING-BASELINE.md`](./08-OPERATING-BASELINE.md).
6. Mengkonfirmasi SLO, RPO, dan RTO dengan pemilik operasional — baseline default diterima pada [`08-OPERATING-BASELINE.md`](./08-OPERATING-BASELINE.md).
7. Membuat ADR lain yang diwajibkan arsitektur sebelum concern terkait diimplementasikan.

### 20.2 Keputusan yang boleh menunggu prototype

- icon package final;
- ilustrasi login;
- sidebar density/default tablet;
- chart visual;
- rich-text toolbar final;
- advanced equation editor;
- custom primary color;
- print/PDF template;
- pilihan Hivekeep atau Hermes dan adapter production.

---

## 21. Definition of Done fitur

Sebuah fitur dinyatakan selesai hanya jika:

1. requirement dan acceptance scenario terkait terpenuhi;
2. authorization positif dan negatif diuji;
3. loading, empty, validation, denied, conflict, network, dan server-error state tersedia sesuai kebutuhan;
4. mobile/desktop behavior tersedia bila fitur mempunyai UI;
5. keyboard, focus, contrast, dan touch target diperiksa;
6. API schema dan error code terdokumentasi;
7. migration, index, transaction, serta idempotency telah direview bila ada perubahan data;
8. log/audit/metric tidak memuat data terlarang;
9. unit/integration/contract/E2E yang relevan lulus;
10. dokumentasi arsitektur/UI/PRD diperbarui bila perilaku berubah;
11. tidak ada TODO correctness atau security yang disembunyikan sebagai pekerjaan lanjutan;
12. reviewer dapat menelusuri requirement ID ke implementasi dan test.

---

## 22. Traceability dokumen

| Concern | Sumber rinci |
|---|---|
| Bentuk aplikasi, domain, database, concurrency, deployment | `01-architecture.md` |
| Capability, approval, API, dan lifecycle external agent | `02-bot-automation.md` |
| Visual, responsive, component behavior, accessibility | `03-ui-ux.md` |
| Tujuan, scope, prioritas, dan acceptance produk | Dokumen ini |

Jika ditemukan perbedaan:

1. hentikan implementasi bagian yang konflik;
2. tentukan apakah konflik merupakan perubahan produk atau detail implementasi;
3. perbarui dokumen yang terdampak dalam perubahan yang sama;
4. buat ADR bila keputusan memengaruhi arsitektur atau data yang sulit dibalik.

---

## 23. Glosarium

| Istilah | Arti |
|---|---|
| Auth session | Session login admin, guru, atau peserta utama |
| Exam session | Satu attempt pengerjaan ujian |
| Attempt | Kesempatan peserta mengerjakan satu schedule |
| Schedule | Aturan waktu, target, mode, attempt, dan release untuk exam revision |
| Question revision | Konten soal versi tertentu yang immutable setelah publish |
| Exam revision | Susunan ujian versi tertentu yang immutable setelah publish |
| Acknowledged answer | Jawaban yang telah dikonfirmasi tersimpan oleh server |
| Outbox | Antrian mutation jawaban pada IndexedDB yang belum diakui server |
| Final answers | Pending answers yang dikirim bersama submit |
| Exact match | Seluruh bagian jawaban harus tepat untuk mendapat bobot penuh |
| Release result | Membuat result utama dapat dilihat peserta |
| Reset grant | Hak satu kali untuk membuat replacement attempt setelah reset admin |
| Integration client | Identitas teknis external agent pada GezyCBT |
| Capability | Izin use case spesifik yang dapat diberikan ke integration client |
| Exact action plan | Snapshot immutable tindakan agent yang akan dikonfirmasi |
| Stable ID | ID resource yang dipakai mutation agar tidak mengandalkan nama ambigu |

---

## Batas PRD

PRD ini mengunci scope dan perilaku produk baseline. Ia tidak menentukan SQL aktual, struktur file final, dependency version, desain pixel-perfect, atau keputusan Bun.SQL sebelum spike selesai. Perubahan besar pada scope, attempt, scoring, result visibility, session correctness, authorization, atau agent permission harus memperbarui PRD sebelum implementasi dilanjutkan.
