# Rancangan UI/UX Web GezyCBT

**Status:** Baseline visual dan interaksi untuk development; belum diimplementasikan  
**Versi dokumen:** 0.6  
**Terakhir diperbarui:** 16 September 2026  
**Berlaku untuk:** Web admin, guru, peserta utama, dan peserta latihan  
**Dokumen induk:** [01-architecture.md](./01-architecture.md)

Dokumen ini menjadi acuan visual dan perilaku antarmuka GezyCBT di web browser. Dokumen arsitektur tetap menjadi sumber aturan domain, keamanan, state, serta reliability. Jika terdapat perbedaan, correctness dan security pada dokumen arsitektur mempunyai prioritas.

Kata **wajib** menunjukkan aturan usability, accessibility, atau reliability yang tidak boleh dilewati. Nilai ukuran dan warna dalam dokumen ini adalah baseline yang dapat disempurnakan setelah prototype diuji pada perangkat nyata.

---

## 1. Ringkasan keputusan visual

| Area | Keputusan |
|---|---|
| Arah visual | Tenang, jelas, akademis, modern, tidak ramai |
| Tema | Ikuti sistem sebagai default; pilihan Terang dan Gelap |
| Warna utama | Biru |
| Sidebar staf | Navy gelap |
| Background halaman | Abu-abu sangat terang |
| Card dan form | Putih dengan border halus |
| Typography | System font stack; tanpa font eksternal |
| Grid spacing | Kelipatan 4 px |
| Staff shell | Sidebar + topbar + content + footer kecil |
| Peserta dashboard | Topbar sederhana tanpa sidebar permanen |
| Halaman ujian | Layout khusus tanpa sidebar dan footer |
| Mobile | Minimum viewport 360 px |
| Touch target | 44 × 44 px untuk peserta/touch; 36–40 px dapat dipakai pada staf desktop |
| Dark mode | Wajib tersedia pada seluruh halaman, termasuk ujian |
| School branding | Logo, nama, dan informasi sekolah; warna utama tetap baseline awal |
| Icon | Satu keluarga outline icon yang konsisten |
| Animasi | Ringan, 120–200 ms; menghormati reduced motion |

### 1.1 Kesan yang ingin dibangun

GezyCBT harus terasa:

- dapat dipercaya ketika ujian berlangsung;
- mudah dipahami tanpa pelatihan panjang;
- cukup padat untuk pekerjaan admin/guru;
- lapang dan fokus untuk peserta;
- stabil walaupun koneksi sedang buruk;
- konsisten pada ponsel, tablet, dan desktop.

GezyCBT tidak memakai visual permainan, dekorasi berlebihan, animasi besar, gradient mencolok, atau elemen yang mengganggu konsentrasi peserta.

### 1.2 Identitas single-school

Karena aplikasi single-tenant, identitas sekolah dapat tampil jelas:

- logo sekolah;
- nama sekolah;
- nama aplikasi GezyCBT;
- tahun ajaran aktif;
- alamat atau kontak pada halaman login bila diperlukan.

Logo sekolah tidak boleh mengubah layout. Area logo memakai container tetap dan gambar menggunakan object-fit contain.

---

## 2. Prinsip UX

### 2.1 Kejelasan lebih penting daripada kepadatan

Setiap layar mempunyai satu tujuan utama. Primary action hanya satu per area. Tombol sekunder tidak memakai penekanan visual yang sama dengan primary action.

### 2.2 Status harus terlihat

Pengguna harus dapat mengetahui:

- sedang berada di halaman apa;
- data sedang dimuat atau sudah selesai;
- perubahan belum disimpan, sedang disimpan, atau sudah tersimpan;
- koneksi online, lambat, atau offline;
- tindakan berhasil atau gagal;
- tindakan berikutnya yang tersedia.

### 2.3 Kesalahan harus dapat diperbaiki

Pesan error menjelaskan:

1. apa yang gagal;
2. bagian yang perlu diperbaiki;
3. tindakan yang dapat dilakukan;
4. request ID jika diperlukan untuk dukungan.

### 2.4 Jangan bergantung pada warna saja

Status memakai kombinasi:

- warna;
- icon;
- label teks;
- bentuk atau border bila diperlukan.

Contoh: soal ditandai memakai warna amber, icon bendera, dan accessible label “Ditandai”.

### 2.5 Server tetap menjadi sumber kebenaran

UI boleh terasa cepat melalui optimistic interaction, tetapi tidak boleh menyatakan “tersimpan” sebelum server memberikan acknowledgment. Halaman ujian membedakan state lokal, sedang disimpan, tersimpan, conflict, dan offline.

### 2.6 Progressive disclosure

Tampilkan informasi yang diperlukan untuk keputusan saat ini. Detail lanjutan berada pada expandable section, drawer, detail page, atau modal. Form panjang dibagi menjadi section yang jelas.

### 2.7 Bahasa utama

Bahasa UI awal adalah Bahasa Indonesia. Istilah teknis internal tidak ditampilkan jika ada istilah pengguna yang lebih mudah dipahami.

---

## 3. Design tokens

Design token menjadi satu-satunya sumber nilai visual lintas komponen. Komponen tidak menulis warna status atau spacing secara bebas.

### 3.1 Warna dasar

| Token konseptual | Nilai | Penggunaan |
|---|---:|---|
| Primary 50 | #EFF6FF | Background selection lembut |
| Primary 100 | #DBEAFE | Badge/info ringan |
| Primary 500 | #3B82F6 | Aksen non-text |
| Primary 600 | #2563EB | Tombol utama dan link |
| Primary 700 | #1D4ED8 | Hover/active dan teks pada Primary 50 |
| Primary 800 | #1E40AF | Active kuat |
| Navy 900 | #0F172A | Sidebar dan teks utama |
| Slate 900 | #0F172A | Heading dan body utama |
| Slate 700 | #334155 | Teks sekunder kuat |
| Slate 600 | #475569 | Teks sekunder |
| Slate 500 | #64748B | Placeholder dan metadata |
| Slate 300 | #CBD5E1 | Border kuat |
| Slate 200 | #E2E8F0 | Border default |
| Slate 100 | #F1F5F9 | Hover neutral |
| Slate 50 | #F8FAFC | Background aplikasi |
| White | #FFFFFF | Surface/card |

### 3.2 Warna semantik

| Makna | Strong | Soft background | Soft text | Penggunaan |
|---|---:|---:|---:|---|
| Success | #15803D | #F0FDF4 | #166534 | Berhasil, active, tersimpan |
| Warning | #B45309 | #FFFBEB | #92400E | Perhatian, waktu menipis |
| Danger | #B91C1C | #FEF2F2 | #991B1B | Error, destructive, waktu kritis |
| Info | #0369A1 | #F0F9FF | #075985 | Informasi dan proses |
| Accent teal | #0F766E | #F0FDFA | #115E59 | Koneksi/pelengkap, bukan primary |

Pasangan teks utama telah dipilih agar memenuhi kontras minimal WCAG AA untuk body text. Contoh:

- #2563EB pada putih: sekitar 5.17:1;
- #0F172A pada #F8FAFC: sekitar 17.06:1;
- #166534 pada #F0FDF4: sekitar 6.81:1;
- #991B1B pada #FEF2F2: sekitar 7.60:1.

### 3.3 Dark theme

Dark theme memakai semantic token yang sama dengan light theme. Komponen tidak memilih warna berdasarkan theme secara manual.

| Token konseptual | Nilai dark | Penggunaan |
|---|---:|---|
| Canvas | #020617 | Background paling belakang |
| Surface | #0F172A | Card, sidebar, modal |
| Surface elevated | #1E293B | Dropdown, selected neutral |
| Border default | #334155 | Border card/input |
| Border strong | #475569 | Divider/focus pendukung |
| Text primary | #F8FAFC | Heading dan body |
| Text secondary | #CBD5E1 | Teks sekunder |
| Text muted | #94A3B8 | Metadata/placeholder |
| Primary link | #93C5FD | Link di surface gelap |
| Primary button | #2563EB | Tombol utama dengan teks putih |
| Success soft | #052E16 / #86EFAC | Background/text status berhasil |
| Warning soft | #451A03 / #FDE68A | Background/text peringatan |
| Danger soft | #450A0A / #FCA5A5 | Background/text error |
| Info soft | #082F49 / #7DD3FC | Background/text informasi |

Aturan theme:

- pilihan tersedia: “Ikuti sistem”, “Terang”, dan “Gelap”;
- default pertama kali adalah “Ikuti sistem” melalui prefers-color-scheme;
- perubahan setting OS diterapkan langsung selama mode masih “Ikuti sistem”;
- override disimpan sebagai preferensi non-sensitif di localStorage dan disinkronkan antar-tab;
- file script first-party terpisah membaca preferensi sebelum Vue mount untuk mengurangi flash theme tanpa memakai inline script yang menyulitkan CSP;
- theme bootstrap dimuat sebagai `<script src="/assets/theme-bootstrap.[hash].js">` dari origin yang sama; baseline `script-src 'self'` mengizinkannya tanpa `unsafe-inline`, nonce, atau CSP source hash. `[hash]` adalah content hash filename untuk cache invalidation, bukan hash allowlist CSP;
- color-scheme browser serta meta theme-color mengikuti theme aktif;
- theme toggle berada di user menu dan halaman login; pada halaman ujian tersedia dalam menu tampilan ringkas;
- mengganti theme tidak me-reset form, scroll penting, timer, outbox, pilihan jawaban, atau focus;
- gambar, logo, scan soal, dan media tidak di-invert otomatis;
- rich text hanya memakai semantic foreground/background yang telah diizinkan;
- syntax/chart/editor yang digunakan kelak wajib mempunyai palette light dan dark;
- screenshot/visual regression mencakup kedua theme dan mode system.

### 3.4 Aturan pemakaian warna

- Primary biru menandai aksi utama dan selection.
- Danger merah hanya untuk error, destructive action, dan waktu sangat kritis.
- Warning amber tidak dipakai sebagai decoration.
- Success hijau tidak dipakai untuk primary button.
- Sidebar navy selalu memakai teks terang.
- Link di content memakai Primary 700 agar tetap jelas.
- Disabled state memakai opacity terukur sekaligus cursor dan aria-disabled; teks tetap terbaca.
- Answer key guru dapat memakai success treatment, tetapi key tidak pernah muncul pada UI peserta.

### 3.5 Typography

Gunakan system font stack agar ringan dan cepat:

~~~text
system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
Roboto, Helvetica, Arial, sans-serif
~~~

| Style | Ukuran/line-height | Weight | Penggunaan |
|---|---|---:|---|
| Display | 32/40 px | 700 | Login branding atau empty welcome terbatas |
| H1 | 28/36 px | 700 | Judul halaman desktop |
| H2 | 24/32 px | 700 | Judul section besar |
| H3 | 20/28 px | 600 | Card/section heading |
| H4 | 18/26 px | 600 | Subsection |
| Body large | 18/30 px | 400 | Soal peserta dan stimulus |
| Body | 16/24 px | 400 | Default content/form |
| Body small | 14/20 px | 400 | Table, metadata, helper |
| Caption | 12/16 px | 500 | Label kecil dan timestamps |
| Button | 14/20 px | 600 | Button dan navigation |

Aturan:

- body peserta tidak boleh lebih kecil dari 16 px;
- teks pertanyaan peserta menggunakan 18 px pada desktop/tablet dan minimal 16 px pada ponsel;
- gunakan tabular numerals untuk timer, nilai, dan angka statistik jika tersedia;
- uppercase hanya untuk singkatan pendek, bukan label panjang;
- panjang baris body ideal 55–80 karakter.

### 3.6 Spacing

| Token | Nilai |
|---|---:|
| space-0 | 0 |
| space-1 | 4 px |
| space-2 | 8 px |
| space-3 | 12 px |
| space-4 | 16 px |
| space-5 | 20 px |
| space-6 | 24 px |
| space-8 | 32 px |
| space-10 | 40 px |
| space-12 | 48 px |
| space-16 | 64 px |

Default:

- gap icon–label: 8 px;
- gap antarfield: 16 px;
- padding card mobile: 16 px;
- padding card desktop: 20–24 px;
- jarak section: 24–32 px;
- page gutter mobile: 16 px;
- page gutter tablet: 24 px;
- page gutter desktop: 32 px.

### 3.7 Radius

| Token | Nilai | Penggunaan |
|---|---:|---|
| radius-sm | 6 px | Input kecil, badge |
| radius-md | 8 px | Button, input, table container |
| radius-lg | 12 px | Card, modal |
| radius-xl | 16 px | Login panel dan prominent card |
| radius-full | 9999 px | Avatar, dot, pill |

Gunakan radius secara konsisten. Card utama memakai 12 px. Input dan button memakai 8 px.

### 3.8 Border dan shadow

| Token | Nilai visual | Penggunaan |
|---|---|---|
| border-default | 1 px #E2E8F0 | Card/input/table |
| border-strong | 1 px #CBD5E1 | Divider kuat |
| focus-ring | 2 px #2563EB + offset 2 px | Keyboard focus |
| shadow-sm | Halus, y 1–2 px | Dropdown/topbar |
| shadow-md | Halus, y 8–16 px | Modal/drawer |

Card biasa lebih mengandalkan border daripada shadow. Shadow kuat dihindari agar halaman tetap tenang.

### 3.9 Sizing

| Elemen | Desktop | Mobile |
|---|---:|---:|
| Topbar staf | 64 px | 56 px |
| Sidebar expanded | 264 px | Drawer |
| Sidebar collapsed | 72 px | n/a |
| Participant header | 64 px | 56 px |
| Input/button medium | 40 px | 44 px |
| Input/button large | 48 px | 48 px |
| Icon default | 20 px | 20 px |
| Avatar | 32–36 px | 32 px |
| Modal max width | 560–720 px | viewport - 32 px |

#### Touch target policy

- halaman peserta, halaman ujian, dan layout dengan coarse pointer wajib memakai target minimum 44 × 44 px;
- kontrol staf desktop memakai tinggi default 40 px;
- kontrol compact 36 px hanya boleh dipakai pada toolbar atau tabel padat ketika media query menunjukkan fine pointer, tersedia jarak antartarget yang cukup, dan label tetap terbaca;
- icon-only button minimum 40 × 40 px pada staf desktop dan 44 × 44 px pada mobile/coarse pointer;
- primary action, destructive action, serta control yang dipakai dalam keadaan mendesak tidak memakai ukuran compact;
- ukuran icon visual dapat tetap 18–20 px, sedangkan clickable area mengikuti ukuran target di atas.

### 3.10 Layer/z-index

| Layer | Nilai |
|---|---:|
| Base content | 0 |
| Sticky table/header | 10 |
| Topbar | 20 |
| Drawer backdrop | 40 |
| Drawer/dropdown | 50 |
| Modal backdrop | 60 |
| Modal | 70 |
| Toast | 80 |
| Critical offline banner | 90 |

### 3.11 Motion

- hover/focus: 120–150 ms;
- drawer/modal: 180–200 ms;
- tidak ada animation lebih dari 300 ms pada flow utama;
- loading spinner tidak membuat layout bergeser;
- prefers-reduced-motion menghapus transform/slide yang tidak diperlukan;
- timer tidak beranimasi setiap detik selain perubahan angka.

---

## 4. Breakpoint dan responsive grid

Breakpoint berdasarkan kebutuhan layout, bukan merek perangkat.

| Nama | Rentang | Perilaku utama |
|---|---|---|
| Mobile small | 360–479 px | Satu kolom, gutter 16 px |
| Mobile | 480–767 px | Satu kolom, beberapa field dapat sejajar |
| Tablet | 768–1199 px | Dua kolom terbatas, sidebar collapsible |
| Desktop | 1200–1599 px | Sidebar + content penuh |
| Wide | ≥1600 px | Content max-width, whitespace bertambah |

Aturan:

- aplikasi wajib berfungsi mulai lebar 360 px;
- tidak ada horizontal page scroll;
- table lebar memakai controlled horizontal scroll di dalam table container;
- form dua kolom kembali menjadi satu kolom di bawah 768 px;
- sticky element tidak boleh menutupi focused input;
- zoom browser 200% tetap dapat digunakan;
- landscape ponsel tidak menghapus atau me-reset state.

Content staff memakai max-width 1440 px. Editor soal/ujian dapat memakai lebar penuh yang tersedia. Halaman login memakai max-width 1120 px. Konten soal peserta idealnya maksimal 880 px, tidak termasuk palette.

---

## 5. App shell

### 5.1 Shell admin

Desktop:

~~~text
┌────────────── Sidebar 264 px ──────────────┬──────── Topbar 64 px ────────┐
│ Logo + GezyCBT                              │ Breadcrumb | Tahun | User    │
│                                              ├──────────────────────────────┤
│ Dashboard                                    │ Page title + actions         │
│ Pengguna                                     │                              │
│ Kelas & Tahun Ajaran                         │ Main content                 │
│ Mata Pelajaran                               │ cards / tables / forms       │
│ Guru & Scope                                 │                              │
│ Integrasi Agent                              │                              │
│ Audit Log                                    │                              │
│ Pengaturan                                   ├──────────────────────────────┤
│                                              │ Footer kecil                 │
└──────────────────────────────────────────────┴──────────────────────────────┘
~~~

Sidebar:

- background Navy 900;
- logo 32 px dan nama aplikasi;
- item tinggi minimal 44 px;
- active item memakai background putih transparan atau Primary 600 dengan left indicator;
- group label memakai teks 12 px;
- dapat collapse menjadi 72 px pada desktop;
- tooltip tampil untuk icon saat collapsed;
- collapse preference dapat disimpan di browser;
- navigation tidak menjadi sumber authorization.

Topbar:

- breadcrumb atau context kiri;
- tahun ajaran aktif;
- optional command/search trigger;
- user menu kanan;
- tidak menampilkan terlalu banyak action;
- sticky di desktop jika content panjang.

Footer:

- berada setelah content, bukan fixed;
- memuat nama aplikasi, versi release, dan tahun;
- tinggi visual sekitar 48 px;
- tidak muncul pada halaman ujian.

### 5.2 Shell guru

Struktur sama dengan admin agar cognitive load rendah, dengan menu:

- Dashboard;
- Bank Soal;
- Ujian;
- Jadwal;
- Monitoring;
- Hasil & Export.

Guru tidak melihat menu admin yang tidak diizinkan. Subject/class scope dapat tampil pada context switcher bila guru mempunyai beberapa scope.

### 5.3 Shell staf pada mobile

- sidebar menjadi drawer dari kiri;
- topbar berisi menu button, page title singkat, dan user menu;
- backdrop menutup drawer ketika area luar dipilih;
- Escape menutup drawer;
- focus terperangkap di drawer saat terbuka;
- menu aktif tetap terlihat;
- page action yang sering digunakan boleh menjadi sticky bottom action bar jika form panjang.

### 5.4 Shell peserta dashboard

Peserta tidak menggunakan sidebar.

~~~text
┌──────────────────────────────────────────────────────┐
│ Logo sekolah | GezyCBT                 Nama | Keluar │
├──────────────────────────────────────────────────────┤
│ Sapaan dan informasi kelas                           │
│                                                      │
│ Ujian tersedia                                      │
│ ┌──────────────────────────────────────────────────┐ │
│ │ Matematika | 08.00–10.00 | 90 menit | [Mulai]  │ │
│ └──────────────────────────────────────────────────┘ │
│                                                      │
│ Riwayat / hasil yang sudah dirilis                   │
├──────────────────────────────────────────────────────┤
│ Footer sederhana                                     │
└──────────────────────────────────────────────────────┘
~~~

Pada mobile, nama sekolah boleh disingkat secara visual tetapi accessible name tetap penuh.

### 5.5 Shell halaman ujian

Halaman ujian tidak memakai sidebar, breadcrumb, footer, global search, atau menu user besar. Semua ruang dan perhatian diberikan pada soal, timer, status simpan, navigasi, dan submit.

---

## 6. Navigation dan information architecture

### 6.1 Admin

| Menu | Halaman |
|---|---|
| Dashboard | Ringkasan user, kelas, jadwal, health operasional |
| Pengguna | Admin, guru, peserta, import, reset password |
| Akademik | Tahun ajaran, kelas, roster, mata pelajaran |
| Guru & Scope | Assignment subject/class |
| Integrasi Agent | Client, credential, grants, action log |
| Audit Log | Filter dan detail perubahan |
| Pengaturan | Identitas sekolah dan baseline konfigurasi |

### 6.2 Guru

| Menu | Halaman |
|---|---|
| Dashboard | Draft, jadwal mendatang, ujian aktif |
| Bank Soal | Banks, questions, revisions, media |
| Ujian | Exam authoring dan revisions |
| Jadwal | Schedule, target, token latihan |
| Monitoring | Session aggregate dan tindakan berwenang |
| Hasil | Result, release, detail, export |

### 6.3 Peserta

| Area | Halaman |
|---|---|
| Login utama | Username dan password |
| Dashboard | Ujian tersedia dan hasil dirilis |
| Ujian | Runtime khusus |
| Hasil | Status submit dan hasil yang boleh dilihat |
| Latihan | Token, identitas, runtime, hasil langsung |

### 6.4 Breadcrumb

- digunakan pada admin/guru untuk hierarchy lebih dari satu tingkat;
- tidak digunakan pada dashboard dan halaman ujian peserta;
- item terakhir adalah teks, bukan link;
- label memakai nama yang mudah dipahami, bukan ID;
- pada mobile tampil maksimal parent dan current page.

### 6.5 Menu × Role

Menu dihitung dari role dan effective capability/scope yang diterima dari endpoint current-user. Tabel ini mengatur visibility, bukan authorization; backend tetap menolak deep link atau API yang tidak diizinkan.

| Menu/fitur | Admin | Guru | Peserta |
|---|---:|---:|---:|
| Dashboard staf | Tampil | Tampil | Tidak |
| Pengguna | Tampil | Tidak | Tidak |
| Tahun ajaran/kelas/roster | Tampil | Tidak | Tidak |
| Mata pelajaran dan scope guru | Tampil | Tidak | Tidak |
| Bank Soal | Tampil semua | Tampil sesuai ownership/scope | Tidak |
| Ujian | Tampil semua | Tampil sesuai ownership/scope | Tidak |
| Jadwal | Tampil semua | Tampil untuk ujian yang dikelola | Tidak |
| Monitoring | Tampil semua | Tampil untuk schedule yang dikelola | Tidak |
| Hasil & Export | Tampil semua | Tampil sesuai scope | Tidak |
| Integrasi Agent | Tampil | Tidak | Tidak |
| Audit Log | Tampil | Tidak | Tidak |
| Pengaturan sekolah | Tampil | Tidak | Tidak |
| Dashboard peserta | Tidak | Tidak | Tampil |
| Ujian tersedia/aktif | Tidak | Tidak | Tampil jika eligible |
| Hasil sendiri | Tidak | Tidak | Tampil jika dirilis |
| Latihan token | Public route | Public route | Public route |

Aturan:

- item parent disembunyikan bila seluruh child tidak tersedia;
- button/action mengikuti capability yang lebih spesifik daripada visibility halaman;
- guru yang dapat membaca tetapi tidak dapat memutasi melihat read-only state dan penjelasan singkat;
- perubahan role/scope setelah login diterapkan setelah current-user refresh atau response 403; UI menghapus cache navigation lama;
- route guard menampilkan halaman 403 yang jelas, bukan mengarahkan diam-diam ke dashboard;
- action tersembunyi tidak dianggap sebagai perlindungan keamanan.

### 6.6 Subject/Class scope switcher

Scope switcher tampil untuk guru yang memiliki lebih dari satu subject atau class scope. Admin menggunakan filter biasa karena mempunyai akses global.

Desktop:

~~~text
┌ Mata pelajaran: [Matematika ▾] ┐  ┌ Kelas: [Semua kelas ▾] ┐
~~~

Mobile: kedua selector berada dalam button “Scope & Filter” yang membuka drawer.

Perilaku:

- pilihan “Semua yang diizinkan” tersedia bila query mendukung gabungan scope;
- route URL menyimpan `subjectId` dan `classId` agar refresh, bookmark, serta back/forward konsisten;
- urutan sumber nilai: URL yang valid, preferensi terakhir yang masih valid, lalu “Semua yang diizinkan”;
- perubahan scope memuat ulang seluruh query page yang scope-dependent;
- cursor/page, row selection, bulk selection, dan target draft sementara di-reset;
- sort dipertahankan jika kolom masih tersedia; filter yang tidak valid pada scope baru dihapus;
- sebelum mengganti scope saat editor mempunyai unsaved changes, UI meminta confirmation;
- scope switcher tidak mengubah grant dan tidak memperluas akses;
- jika scope dicabut ketika halaman terbuka, response 403/empty-scope mengembalikan switcher ke scope valid dan menjelaskan perubahan;
- nama subject/class yang panjang memakai truncation visual dengan tooltip dan accessible full label;
- loading scope baru menjaga shell tetap stabil dan memberi aria-busy pada content region.

---

## 7. Komponen dasar

### 7.1 Button

| Variant | Penggunaan |
|---|---|
| Primary | Aksi utama: Simpan, Lanjutkan, Buat |
| Secondary | Aksi alternatif penting |
| Tertiary/ghost | Toolbar, cancel ringan, navigation |
| Danger | Delete/archive/close yang berdampak |
| Link | Navigasi inline |

Aturan:

- satu primary button utama per form/section;
- button mempunyai default, hover, active, focus, loading, dan disabled state;
- loading mempertahankan lebar button;
- icon-only button wajib memiliki accessible label dan tooltip;
- destructive button tidak ditempatkan berdampingan tanpa jarak dengan primary save;
- tombol submit ujian memiliki label eksplisit “Kumpulkan Ujian”.

### 7.2 Input

Anatomi:

~~~text
Label wajib
[ Prefix | Nilai input                         | Suffix ]
Helper text atau error
~~~

Aturan:

- label selalu terlihat; placeholder bukan pengganti label;
- required ditandai teks atau simbol dengan penjelasan;
- error muncul dekat field dan pada summary untuk form panjang;
- input height minimal 40 px staf dan 44 px mobile;
- password menyediakan show/hide;
- number input mempunyai unit dan batas yang jelas;
- date/time menampilkan zona Asia/Jakarta;
- data disimpan UTC tetapi UI tidak menampilkan UTC kepada pengguna sekolah.

### 7.3 Select dan combobox

- select native dapat digunakan untuk pilihan sederhana;
- searchable combobox digunakan untuk data besar;
- pilihan aktif dapat digunakan keyboard;
- query remote memakai debounce;
- hasil kosong menjelaskan tindakan berikutnya;
- selected value memakai stable ID secara internal.

### 7.4 Checkbox, radio, switch

- radio untuk satu pilihan;
- checkbox untuk pilihan independen atau multiple response;
- switch hanya untuk pengaturan yang berlaku segera dan mudah dibalik;
- setting berisiko memakai button + confirmation, bukan switch;
- seluruh control mempunyai label klik yang luas.

### 7.5 Card

Variant:

- standard card: grouping content;
- statistic card: satu angka dan konteks;
- action card: item ujian/jadwal;
- status card: warning atau error;
- question card: editor/preview;
- flat section: digunakan bila terlalu banyak nested card.

Card tidak boleh berlapis lebih dari dua tingkat. Border dan spacing dipakai untuk hierarchy.

### 7.6 Table

Desktop:

- header sticky hanya jika tabel panjang;
- sort indicator selalu terlihat pada kolom sortable;
- row action dalam menu jika lebih dari dua;
- checkbox selection hanya untuk operasi bulk yang tersedia;
- pagination di bawah dan dapat diakses keyboard;
- angka rata kanan, teks rata kiri;
- status berupa badge + teks;
- jangan memuat seluruh data tanpa pagination.

Mobile:

- tabel sederhana boleh horizontal scroll;
- tabel operasional kompleks berubah menjadi stacked row/card;
- primary identity tetap terlihat;
- action masuk overflow menu;
- jangan menyembunyikan data kritis hanya untuk menghindari scroll.

### 7.7 Badge dan status

Contoh:

| Status | Treatment |
|---|---|
| Draft | Neutral gray |
| Published | Blue/info |
| Scheduled | Teal/info |
| Active | Green + dot indicator; animasi pulse aktif, tetapi dimatikan pada `prefers-reduced-motion: reduce` dan dot tetap terlihat statis |
| Ended/Diakhiri | Amber outline; label mengikuti `finalization_reason` |
| Finished | Slate |
| Archived | Neutral outline |
| Failed/blocked | Red |

Status domain selalu memakai istilah Bahasa Indonesia pada UI, walaupun enum API berbahasa Inggris.

Untuk session final, label penyebab memakai satu pemetaan pada seluruh dashboard, monitoring, drawer, dan halaman peserta:

| `finalization_reason` | Label UI |
|---|---|
| `PARTICIPANT_SUBMIT` | Dikumpulkan |
| `DEADLINE` | Waktu Habis |
| `STAFF_END` | Diakhiri Petugas |
| `SCHEDULE_CLOSE` | Jadwal Ditutup |
| `RESET_ATTEMPT` | Attempt Direset |

Label penyebab tidak menggantikan status rilis hasil. Contohnya, session dapat berlabel **Diakhiri Petugas** sekaligus mempunyai status hasil **Belum dirilis**.

### 7.8 Alert dan banner

- inline alert untuk konteks lokal;
- page banner untuk masalah seluruh halaman;
- offline banner untuk halaman ujian;
- icon, heading pendek, dan tindakan;
- tidak auto-dismiss jika pengguna harus bertindak;
- warning tidak memakai dialog kecuali tindakan tidak dapat diteruskan.

### 7.9 Toast

Toast digunakan untuk feedback non-kritis seperti “Draft berhasil disimpan”. Error yang memerlukan perbaikan tetap tampil di halaman/form. Toast:

- kanan atas desktop;
- bawah tengah mobile, di atas sticky action;
- 4–6 detik untuk success/info;
- tidak auto-dismiss untuk error penting;
- maksimal tiga toast terlihat;
- kemunculan toast tidak memindahkan focus;
- toast sukses/info memakai `role="status"`, sedangkan error unik yang harus segera ditindaklanjuti dapat memakai `role="alert"`.

### 7.10 Modal dan drawer

Modal:

- confirmation, form singkat, preview kecil;
- bukan untuk editor soal lengkap;
- saat dibuka, focus menuju elemen interaktif pertama yang bermakna; destructive confirmation memulai pada Cancel/aksi paling aman;
- focus trap, Escape, dan setelah ditutup focus kembali ke trigger;
- destructive confirmation menyebut object dan dampak.

Drawer:

- mobile navigation;
- question palette pada mobile;
- filter kompleks;
- detail tambahan yang tidak membutuhkan URL terpisah.

### 7.11 Tabs

- maksimal 5–6 tab;
- tab untuk peer views dalam resource yang sama;
- URL mencerminkan tab penting;
- mobile boleh horizontal scroll dengan indicator;
- tab tidak dipakai sebagai wizard.

### 7.12 Empty state

Empty state menjelaskan:

- data apa yang belum ada;
- mengapa mungkin kosong;
- aksi utama yang dapat dilakukan;
- ilustrasi opsional yang ringan.

Contoh: “Belum ada soal di bank ini. Buat soal pertama atau impor soal.”

### 7.13 Loading

- skeleton untuk page/card/table;
- spinner untuk button atau proses singkat;
- progress indicator untuk import/export panjang jika progress diketahui;
- layout skeleton menyerupai content agar tidak bergeser;
- loading lebih dari beberapa detik menampilkan teks status.

---

## 8. Halaman authentication

### 8.1 Login admin/guru

Desktop:

~~~text
┌──────────────────────────────┬──────────────────────────────┐
│ Identitas sekolah            │ Masuk sebagai Staf           │
│ Logo + nama                  │ Username                     │
│ Pesan singkat                │ Password [lihat]             │
│ Ilustrasi geometris ringan   │ [ Masuk ]                    │
│                              │ Bantuan: hubungi admin       │
└──────────────────────────────┴──────────────────────────────┘
~~~

Mobile hanya menampilkan logo ringkas dan form. Tidak ada ilustrasi besar.

Aturan:

- judul membedakan login staf dan peserta;
- browser autocomplete username/current-password diaktifkan;
- error credential bersifat generic;
- caps-lock hint boleh ditampilkan;
- button tetap terlihat ketika keyboard mobile terbuka;
- rate-limit message tidak membocorkan keberadaan akun.

### 8.2 Login peserta utama

Lebih sederhana dan memakai card terpusat:

- logo/nama sekolah;
- judul “Masuk untuk Mengikuti Ujian”;
- username;
- password;
- tombol masuk;
- petunjuk singkat menghubungi pengawas.

Tidak ada link pendaftaran atau lupa password mandiri pada baseline.

Jika peserta memilih schedule MAIN yang meminta kode akses, setelah login berhasil peserta melihat langkah kedua **Kode Ujian**. Kode ini tidak menggantikan username/password atau pemeriksaan eligibility. Input menerima lima karakter dari alfabet uppercase/digit yang tidak ambigu, mengubah lowercase ke uppercase, dan mengabaikan hyphen saat validasi. Setelah kode valid, peserta dapat memulai atau melanjutkan schedule tersebut.

### 8.3 Latihan dengan token

Flow dua langkah:

1. Masukkan token latihan.
2. Setelah token valid, masukkan identitas yang diminta.

Token latihan adalah kode lima karakter dari alfabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789`. Input menerima paste, mengubah lowercase ke uppercase, dan mengabaikan hyphen yang dipakai sebagai pemisah tampilan. Token ditampilkan dalam group yang mudah dibaca; contoh canonical `ABCDE`. Error token tidak menghapus input identitas yang sudah valid kecuali token berubah.

### 8.4 Form identitas latihan

Setelah token valid, server mengirim konfigurasi field schedule. Baseline field:

| Field | Aturan |
|---|---|
| Nama lengkap | Selalu wajib; 1–200 karakter Unicode setelah trim |
| Instansi/sekolah | Optional atau wajib sesuai schedule; maksimum 200 karakter |
| Kelas | Optional atau wajib sesuai schedule; maksimum 150 karakter atau pilihan allowlist |
| Field tambahan | Hanya key/type/label yang telah didefinisikan sekolah; text atau select pada baseline |

Aturan UX:

- label “Wajib” ditampilkan pada field required;
- validasi client memberi feedback cepat, tetapi server tetap authoritative;
- whitespace-only dianggap kosong;
- error tampil inline dan dihubungkan ke input melalui `aria-describedby`;
- nilai tidak dihapus ketika server mengembalikan validation error;
- focus berpindah ke error summary lalu dapat menuju field pertama yang salah;
- token valid tetap berada di memory selama form diperbaiki dan belum expired;
- jika token expired saat form dikirim, UI kembali ke langkah token dengan penjelasan dan mempertahankan identity draft hanya di memory;
- mengganti token membersihkan konfigurasi field yang lama setelah confirmation bila form sudah diisi;
- token, identity, dan practice credential tidak disimpan di localStorage;
- identity dianggap snapshot laporan, bukan verifikasi bahwa orang tersebut benar-benar pemilik nama;
- setelah session berhasil dibuat, identity snapshot tidak dapat diedit; koreksi membuat session baru bila attempt policy mengizinkan dan tidak mengubah histori lama;
- tombol “Mulai Latihan” disabled selama request berjalan dan memakai start idempotency key.

---

## 9. Halaman admin

### 9.1 Dashboard

Urutan:

1. Page title dan tahun ajaran aktif.
2. Alert operasional jika ada.
3. Statistic cards: peserta aktif, guru, kelas, jadwal hari ini.
4. Jadwal/ujian aktif.
5. Aktivitas administratif terbaru.

Statistic card tidak boleh menjadi satu-satunya tempat informasi kritis. Angka dapat diklik jika menuju filtered list.

### 9.2 Pengguna

Header:

- judul;
- search;
- filter role/status/class;
- tombol “Tambah Pengguna”;
- menu “Impor”.

Table:

- nama;
- username;
- role;
- class/scope ringkas;
- status;
- last login bila tersedia;
- actions.

Reset password dan disable account memakai confirmation dengan nama user serta dampak session revoke.

### 9.3 Import peserta

Wizard:

1. Unduh template.
2. Pilih file.
3. Preview dan validasi.
4. Perbaiki error.
5. Konfirmasi import.
6. Hasil dan one-time password download bila ada.

Error row dapat difilter dan diunduh. Commit button disabled sampai blocking errors selesai.

#### Import preview UI

Preview hingga 1.500 row tidak dirender sekaligus:

- summary menampilkan total, akan dibuat, akan diperbarui, tidak berubah, duplikat, error, dan blocking error;
- tabel memakai server-side pagination default 50 row serta filter `Semua`, `Baru`, `Berubah`, `Tidak berubah`, `Duplikat`, dan `Error`;
- virtual scroll tidak digunakan karena pagination lebih mudah diakses, menjaga posisi pengguna secara deterministik, dan konsisten dengan hasil server;
- setiap row menampilkan nomor baris file, identitas aman, kelas tujuan, classification, serta pesan per field;
- template baseline tidak menerima kolom password; bila ditemukan, row/file mendapat blocking error tanpa memantulkan nilainya; kolom credential hanya menunjukkan status seperti “Akan dibuat saat import” atau “Tidak diperlukan”;
- tombol **Unduh Baris Error** menghasilkan CSV aman berisi nomor row, field, code, dan pesan tanpa password atau token;
- perbaikan dilakukan dengan mengganti file lalu menjalankan preview baru; row preview tidak dapat diedit di browser karena commit harus memakai normalized payload yang telah divalidasi server.

API mengembalikan ID preview, expiry, dan opaque commit token. Token/hash adalah detail internal: tidak ditampilkan, tidak dapat disalin, tidak dimasukkan ke URL, dan hanya disimpan dalam memory wizard. Pengguna hanya melihat pesan seperti “Preview berlaku sampai 14.30 WIB”. Refresh atau meninggalkan wizard dapat meminta upload/preview ulang bila token memory hilang.

Tombol **Import Peserta**:

- disabled selama masih ada blocking error, preview expired, file berubah, commit sedang berjalan, atau permission dicabut;
- tetap disabled pada mode `create-only` bila terdapat row yang akan mengubah akun lama;
- confirmation menyebut jumlah create/update/unchanged/skipped;
- commit memakai idempotency key dan tidak mengirim row yang dapat dimanipulasi dari browser;
- hasil akhir menampilkan count serta action one-time credential download bila dibuat; download meminta re-authentication, diaudit, dan credential tidak ditampilkan di tabel preview.

Setelah commit berhasil, wizard berpindah ke langkah **Hasil**, badge preview berubah menjadi **Selesai**, dan tombol commit tetap disabled. Navigasi Back atau pembukaan ulang URL preview menampilkan ringkasan commit read-only dan mengarahkan pengguna ke hasil import; browser tidak pernah menawarkan commit ulang. Retry dengan idempotency key yang sama menampilkan outcome terdahulu. Row preview rinci boleh sudah dibersihkan server, tetapi count hasil, waktu commit, actor, request ID, dan status one-time credential artifact tetap dapat ditampilkan selama masa retensi summary.

### 9.4 Akademik

Tahun ajaran, kelas, roster, dan mata pelajaran menggunakan master-detail atau page terpisah. Roster memakai search dan batch assignment. Current academic year ditandai jelas.

### 9.5 Integrasi agent

Halaman memperlihatkan:

- client name dan platform hint;
- owner;
- active/revoked status;
- credential prefix dan last used;
- capability/grant summary;
- recent actions;
- rotate/revoke/kill switch.

Plaintext credential hanya tampil sekali dalam modal khusus, tidak dapat dibuka kembali, dan mempunyai tombol salin dengan peringatan penyimpanan aman.

### 9.6 Audit log

- filter actor, action, entity, date, dan request ID;
- cursor pagination;
- row ringkas dan detail drawer;
- before/after yang direduksi;
- timestamp Asia/Jakarta;
- tidak ada edit/delete action.

Detail drawer mempunyai section:

1. Ringkasan: action, outcome, timestamp, request ID.
2. Actor: user/agent/system, role, dan source yang aman.
3. Entity: type, stable ID, serta link jika masih dapat diakses.
4. Perubahan: before/after hanya untuk field allowlist.
5. Metadata teknis aman: reason, idempotency/action reference, dan error code.

Aturan rendering:

- password, credential, token, cookie, answer key, raw answer, dan PII yang tidak diperlukan tampil sebagai `[REDACTED]`;
- field yang tidak dicatat dibedakan dari field yang di-redact;
- JSON dirender sebagai escaped read-only tree, tidak pernah sebagai HTML;
- depth, jumlah item, dan panjang value dibatasi; sisanya diberi label “Dipotong”;
- before/after menandai ditambah, berubah, dan dihapus dengan teks/icon selain warna;
- copy hanya tersedia untuk request ID, entity ID, dan value yang dinyatakan aman;
- drawer dapat dibuka melalui URL/query agar back button bekerja, tetapi metadata sensitif tidak masuk URL;
- loading/error drawer tidak menghapus filter audit list.

---

## 10. Halaman guru

### 10.1 Dashboard

Prioritas:

- ujian aktif sekarang;
- jadwal berikutnya;
- draft soal/ujian yang belum valid;
- export terbaru;
- quick actions.

Quick action maksimal 3–4: Buat soal, Buat ujian, Buat jadwal, Lihat hasil.

### 10.2 Bank soal

List bank menampilkan:

- nama;
- subject;
- owner/shared;
- jumlah soal;
- jumlah draft/published;
- updated time.

Question list memiliki filter type/status/tag/search. Preview soal tidak menampilkan semua isi panjang di table; gunakan side panel atau detail page.

### 10.3 Editor soal

Desktop:

~~~text
┌──────────────────────────────────┬────────────────────────────┐
│ Form editor                      │ Preview                    │
│ Bank / type                      │ Tampilan peserta           │
│ Stimulus                         │                            │
│ Pertanyaan                       │ Validation summary         │
│ Opsi / pernyataan                │ Revision info              │
│ Kunci jawaban                    │                            │
│ Media                            │                            │
├──────────────────────────────────┴────────────────────────────┤
│ [Simpan Draft] [Validasi]                     [Publish]       │
└───────────────────────────────────────────────────────────────┘
~~~

Tablet/mobile:

- editor dan preview menjadi tab;
- sticky bottom action bar;
- perubahan belum tersimpan terlihat;
- preview memakai participant renderer yang sama sejauh aman;
- answer key hanya pada mode guru.

Editor type:

- SINGLE_CHOICE: opsi draggable hanya jika accessible reorder juga tersedia;
- MULTIPLE_RESPONSE: checkbox kunci dapat memilih lebih dari satu;
- TRUE_FALSE: tepat tiga statement dengan selector Benar/Salah;
- opsi memiliki label A–J yang dihasilkan UI;
- delete option membutuhkan minimal count tetap terpenuhi;
- validation summary link menuju field bermasalah.

#### Media upload dan preview

- baseline menerima JPEG, PNG, dan WebP sesuai batas ukuran/dimensi server; SVG, HTML, video, dan audio ditolak;
- setelah file dipilih, tampilkan thumbnail dengan `object-fit: contain`, nama file, dimensi, ukuran, status upload, dan action preview ukuran lebih besar;
- preview ukuran besar memakai dialog yang menjaga aspect ratio, dapat ditutup dengan keyboard, dan tidak mengubah file asli;
- gambar informatif wajib mempunyai field alt text; field kosong menjadi blocking publish error;
- gambar yang benar-benar dekoratif memerlukan pilihan eksplisit “Dekoratif”; renderer peserta kemudian memakai alt kosong dan tidak membacanya sebagai konten;
- progress ditampilkan per file dengan status Menunggu, Mengunggah, Memproses, Siap, atau Gagal;
- error menjelaskan type/size/dimension/network/server issue dan menyediakan **Coba Lagi** atau **Pilih File Lain**;
- cancel sebelum upload selesai membatalkan request bila memungkinkan dan membersihkan preview lokal;
- media baru belum dianggap tersimpan ke revision sampai relasi draft mendapat acknowledgment server.

Media yang telah direferensikan published revision tidak dapat dihapus atau diganti pada revision tersebut. Pada draft baru, guru dapat melepas media dari draft atau memilih asset pengganti; tindakan itu tidak mengubah revision published. Jika asset masih direferensikan di tempat lain, UI menampilkan “Masih digunakan” dan tidak menawarkan penghapusan fisik. Penghapusan asset orphan dilakukan sistem sesuai retention.

### 10.4 Editor ujian

Section:

1. Informasi ujian.
2. Daftar soal.
3. Points.
4. Randomization.
5. Validation/readiness.

Question picker memakai search/filter dan selected tray. Jangan me-render seluruh content soal untuk ratusan row. Reorder mendukung keyboard controls selain drag.

#### Question picker behavior

Daftar tersedia memakai server-side cursor pagination default 50 item, search debounce, serta filter bank, tipe, status revision, dan tag. Untuk 100+ soal, UI hanya menampilkan judul/ringkasan pendek, tipe, bank, revision, dan status; konten lengkap dibuka di preview drawer sesuai izin.

Aturan pemilihan:

- soal yang sudah masuk selected tray ditandai **Sudah dipilih** dan action tambah disabled;
- selection disimpan berdasarkan stable revision ID dan tidak hilang ketika search, filter, atau page berubah;
- filter “Belum dipilih” dan “Sudah dipilih” tersedia;
- revision yang sama tidak dapat ditambahkan dua kali;
- menambah soal mempertahankan focus pada action pemicu, menandainya sebagai sudah dipilih, dan mengumumkan posisi item baru melalui live region polite.

Selected tray menampilkan urutan, ringkasan, tipe, bobot, serta action **Naik**, **Turun**, **Preview**, dan **Hapus dari ujian**. Tombol Naik/Turun menjadi alternatif keyboard utama untuk drag-and-drop, mempertahankan focus pada item yang dipindah, dan mengumumkan posisi baru. Hapus hanya melepas soal dari draft exam, tidak menghapus soal dari bank; tampilkan Undo selama perubahan belum disimpan. Setelah save berhasil, penambahan kembali tetap dapat dilakukan melalui picker.

### 10.5 Publish readiness report

Question dan exam editor memakai pola report yang sama.

~~~text
┌ Kesiapan Publikasi ──────────────────────────────────────────┐
│ 3 Error   2 Peringatan   8 Pemeriksaan Lulus                │
│                                                               │
│ ERROR                                                        │
│ • Soal 12 belum mempunyai jawaban benar       [Buka soal]    │
│ • Bobot soal 18 harus lebih besar dari 0       [Buka field]   │
│                                                               │
│ PERINGATAN                                                   │
│ • Stimulus soal 7 sangat panjang               [Tinjau]       │
└───────────────────────────────────────────────────────────────┘
~~~

Aturan:

- summary menampilkan jumlah error, warning, dan pemeriksaan lulus;
- issue dikelompokkan berdasarkan severity, lalu section/entity;
- setiap issue menampilkan message, object label, optional code, dan action menuju field/soal;
- action mengaktifkan tab/accordion yang benar, scroll ke target, lalu memindahkan focus;
- filter tersedia untuk severity dan section bila issue banyak;
- group dapat collapse, tetapi group error terbuka secara default;
- publish disabled selama masih ada ERROR;
- WARNING tidak memblokir secara default, tetapi confirmation publish menyebut jumlah warning yang belum diselesaikan;
- setelah draft berubah, report ditandai “Perlu divalidasi ulang”; report lama tidak dianggap valid;
- validation request mempunyai loading state dan tidak menutup editor;
- report 100+ issue memakai grouped pagination/rendering bertahap, bukan satu modal sangat panjang;
- pada mobile report menjadi full-height drawer atau page section, bukan modal sempit;
- UI menampilkan server report apa adanya dan tidak membuat aturan publish sendiri.

### 10.6 Jadwal

Form mengelompokkan:

- exam revision;
- jenis MAIN/PRACTICE;
- target class/participant;
- waktu akses;
- duration dan hard deadline;
- attempt/result policy;
- kode MAIN atau token PRACTICE dan identity fields.

Waktu ditampilkan Asia/Jakarta dan summary akhir menyebut tanggal lengkap, bukan hanya jam.

Untuk schedule MAIN dan PRACTICE, guru dapat memilih **Buat Otomatis** atau mengusulkan kode lima karakter. Server menormalisasi uppercase, memvalidasi alfabet, dan menolak kode yang sedang dipakai schedule lain. Kode plaintext hanya ditampilkan sekali setelah pembuatan atau rotasi, dalam dialog yang menjelaskan bahwa kode perlu disalin saat itu. Pada kunjungan berikutnya, card jadwal hanya menampilkan hint tersamarkan dari server, misalnya `••••-AB7K`, waktu rotasi, status aktif, dan action rotasi yang sesuai mode. Hint dipakai untuk membantu guru mengenali kode saat support dan audit; hint tidak dapat dipakai untuk autentikasi atau lookup. Rotasi menolak start baru dengan kode lama, tetapi tidak membatalkan session yang sudah aktif.

Jadwal `CLOSED` dapat diarsipkan oleh admin melalui action **Arsipkan** pada card. Konfirmasi menjelaskan bahwa card akan hilang dari daftar utama, sedangkan hasil ujian dan audit tetap tersedia. Daftar utama secara default tidak memuat `ARCHIVED`; tombol **Tampilkan arsip** mengganti tampilan menjadi daftar arsip yang read-only. Guru dapat melihat schedule `CLOSED` dalam scope-nya, tetapi tidak dapat mengarsipkan. Hard delete hanya berlaku untuk draft yang belum memiliki data runtime.

### 10.7 Monitoring

Dashboard monitoring memakai polling ringan:

- counts: target, belum mulai, active, submitted, expired;
- last updated;
- filter/search participant;
- session status table;
- tindakan Perpanjang Waktu/Akhiri Sesi sesuai izin serta Tutup Jadwal pada tingkat schedule.

Chart hanya pelengkap. Semua informasi juga tersedia dalam angka/table.

Pada desktop, action header monitoring disusun dari kiri ke kanan sebagai **Pause/Resume**, **Segarkan**, lalu **Tutup Jadwal** di sisi kanan dengan pemisah visual dan gaya danger/secondary. Pada mobile, **Tutup Jadwal** masuk menu overflow **Tindakan Jadwal** agar tidak berdesakan dengan kontrol refresh. Action tetap berada pada header schedule dan tidak pernah masuk drawer session individual.

#### Monitoring interval policy

- default refresh 15 detik dengan jitter acak ±3 detik;
- tombol Pause/Resume selalu tersedia dan preference hanya berlaku selama page visit;
- polling berhenti ketika tab browser hidden dan dilanjutkan segera ketika visible;
- header menampilkan relative age seperti “Diperbarui 12 detik lalu”, absolute timestamp pada tooltip/detail, dan countdown refresh berikutnya;
- setelah dua interval gagal, badge berubah menjadi “Data mungkin sudah usang” dengan action “Coba sekarang”;
- schedule final menurunkan interval atau menghentikan auto-refresh;
- aggregate cards dan session list adalah query terpisah;
- seluruh session list memakai server-side cursor pagination default 50 row; untuk schedule di atas 200 peserta pagination dan aggregate counts wajib serta tidak dapat diganti menjadi “Tampilkan semua”;
- search/filter/sort dilakukan server-side dan reset cursor;
- virtual scroll bukan baseline karena seluruh 1.000 row tidak boleh diambil sekaligus;
- row yang sedang dibuka tidak berubah posisi mendadak; refresh mempertahankan filter serta row detail jika masih ada;
- polling failure tidak menghapus data terakhir yang berhasil diterima.

#### Session detail drawer

Memilih row membuka detail drawer tanpa meninggalkan monitoring. Drawer disimpan pada URL/query dengan session ID aman agar Back menutup drawer dan refresh dapat memulihkannya. Pada ponsel, drawer menjadi full-height sheet/page overlay dengan tombol kembali yang jelas.

Detail hanya menampilkan:

- nama/username atau identity snapshot latihan sesuai scope;
- attempt number dan session status;
- waktu mulai, deadline, submit/expired/scored bila ada;
- progress `dijawab/total`, tanpa isi jawaban;
- last activity dengan timestamp absolut dan relative age;
- result summary setelah final bila role/scope mengizinkan;
- audit ringkas untuk extension, Akhiri Sesi, atau reset yang relevan.

`last activity` tidak diberi label “Online” karena polling HTTP dan `last_seen_at` tidak membuktikan koneksi saat ini. Drawer tidak menampilkan raw answer, answer key, pending outbox browser, IP mentah, cookie, atau fingerprint perangkat.

Action **Perpanjang Waktu** dan **Akhiri Sesi** tersedia di drawer hanya untuk session aktif dan actor berwenang, lalu membuka form pada section 10.9 dengan identitas serta deadline sudah terisi. **Tutup Jadwal** tidak ditempatkan dalam drawer karena berdampak pada seluruh schedule. Drawer melakukan refresh ringan bersama monitoring, mempertahankan data terakhir ketika gagal, dan menampilkan stale indicator sendiri bila detail tidak dapat diperbarui.

### 10.8 Hasil dan export

- summary nilai;
- result release status;
- participant table;
- filter class/status/score;
- release/unrelease action dengan impact count;
- export button membuka pilihan kolom dan filter;
- job status tampil tanpa blocking page.

#### Result release UI

Result table mempunyai kolom status **Belum dirilis** atau **Dirilis** dan waktu rilis. Filter release status tersedia bersama filter class/score; actor tersedia melalui audit detail agar query tabel tetap ringan.

Pemilihan subset mengikuti pola berikut:

1. Checkbox memilih result pada page saat ini.
2. Setelah seluruh page dipilih, UI dapat menawarkan “Pilih semua N hasil yang cocok dengan filter”.
3. Banner selection selalu menyebut apakah target adalah ID terpilih atau seluruh hasil sesuai filter.
4. Pergantian filter membersihkan selection lintas-filter setelah confirmation.
5. Result yang belum selesai/scored tidak dapat dipilih untuk release.

Confirmation release menyebut ujian, filter/scope, jumlah target, already released, dan akibat bahwa peserta dapat melihat hasil. Response menampilkan jumlah berhasil, sudah dirilis, dilewati, dan gagal; partial outcome tetap terlihat dan row diperbarui dari server.

Unrelease menggunakan pemilihan yang sama, meminta alasan wajib, dan menjelaskan bahwa tindakan hanya menyembunyikan hasil pada request peserta berikutnya. Informasi yang sudah dilihat, disalin, difoto, atau diunduh tidak dapat ditarik kembali. Peserta yang masih membuka halaman dapat tetap melihat data yang sudah dimuat sampai navigasi/refresh; GezyCBT tidak mengklaim penghapusan dari layar atau ingatan pengguna. Release dan unrelease selalu diaudit.

Export flow:

1. User memilih format, filter, kolom, dan apakah PII disertakan.
2. Confirmation menampilkan perkiraan jumlah row serta expiry file.
3. Setelah request diterima, job muncul pada halaman **Hasil → Riwayat Export**.
4. Compact progress juga muncul pada activity drawer/topbar agar user dapat pindah halaman.
5. Status memakai Menunggu, Diproses, Siap, Gagal, atau Kedaluwarsa.
6. UI melakukan polling ringan selama halaman/activity drawer terbuka; tidak membutuhkan WebSocket.
7. Saat selesai, tampilkan toast dan persistent unread indicator pada activity drawer.
8. Download meminta short-lived token dan audit dilakukan server.

Aturan state:

- QUEUED/RUNNING menampilkan created time dan progress bila tersedia;
- READY menampilkan ukuran, format, expiry, serta tombol “Unduh”;
- FAILED menampilkan safe error dan “Coba Buat Lagi” dengan form/filter lama;
- EXPIRED menampilkan “File telah kedaluwarsa” dan tombol “Buat Ulang”; tombol download hilang;
- toast bukan satu-satunya tempat mengetahui completion;
- menutup browser tidak membatalkan job;
- user hanya melihat job miliknya atau job dalam scope yang diizinkan;
- daftar job dipaginasi dan file lama dibedakan dari data hasil authoritative.

### 10.9 Perpanjang waktu, Akhiri Sesi, reset attempt, dan Tutup Jadwal

**Perpanjang waktu** tersedia dari detail session sesuai izin:

- tampilkan peserta, ujian, status, deadline sekarang, dan sisa waktu;
- input menit berupa integer positif dengan preset 5, 10, 15, 30 dan pilihan custom dalam batas server;
- preview menampilkan deadline sebelum dan sesudah;
- alasan wajib, maksimum 500 karakter;
- confirmation menyebut perubahan tidak dapat memendekkan waktu;
- submit membawa expected session version dan idempotency key;
- success memperbarui row, detail, serta timestamp monitoring tanpa menunggu polling berikutnya.

Peserta menerima deadline baru dari response save/heartbeat/resume. Timer dikoreksi tanpa reload dan banner satu kali berbunyi, misalnya “Waktu ditambah 15 menit. Batas baru 10.45 WIB.” Announcement menggunakan aria-live polite. Perubahan theme atau navigasi soal tidak menghapus banner sebelum sempat dibaca.

Baseline tidak memakai push notification atau WebSocket untuk time extension. Jika peserta sedang online, deadline baru diterima melalui save/resume response berikutnya; jika halaman dibuka kembali, resume selalu membawa deadline authoritative terbaru.

**Akhiri Sesi** hanya menargetkan satu peserta/session:

- tersedia pada detail session yang masih aktif untuk admin atau guru yang mengelola schedule;
- dialog menampilkan peserta, attempt, progress committed, deadline, dan waktu aktivitas terakhir;
- alasan wajib, maksimum 500 karakter;
- warning menjelaskan bahwa jawaban pending yang hanya berada di perangkat peserta tidak terlihat oleh staf dan tidak ikut dinilai;
- confirmation menyebut bahwa session segera menjadi final, save berikutnya ditolak, dan hasil mengikuti kebijakan rilis normal;
- request membawa expected session version dan idempotency key;
- bila save bersamaan selesai lebih dahulu, jawaban tersebut ikut dinilai; bila Akhiri Sesi menang lebih dahulu, save ditolak sebagai final state;
- keberhasilan mengubah row/detail menjadi **Diakhiri Petugas**, menampilkan pesan “Sesi diakhiri. Hasil mengikuti kebijakan rilis jadwal.”, dan tidak otomatis memberi attempt baru;
- jika response menunjukkan `released_at = null`, UI menampilkan **Hasil belum dirilis**; UI hanya menyebut hasil tersedia bila server benar-benar mengembalikan status released, termasuk ketika policy `IMMEDIATE_SCORE` berlaku.

**Reset attempt** hanya tampil untuk admin pada baseline:

- detail menjelaskan session/attempt lama, status, submitted/score state, dan attempt berikutnya;
- alasan wajib;
- confirmation menyatakan session, answer, result, dan audit lama tetap disimpan;
- reset menutup/finalisasi session active sesuai policy lalu membuka hak memulai attempt baru;
- peserta tidak otomatis dipindahkan ke attempt baru; dashboard menampilkan **Attempt baru tersedia** setelah refresh/resume;
- button memakai loading/idempotency dan hasil menampilkan eligibility **Attempt baru tersedia**; session pengganti baru dibuat ketika peserta menekan “Mulai Ujian”, sehingga UI tidak mengklaim sudah mempunyai ID attempt baru;
- operasi gagal karena expected state berubah menampilkan data terbaru dan meminta review ulang.

**Tutup Jadwal** adalah action terpisah pada header monitoring schedule:

- berdampak pada seluruh schedule, bukan session yang sedang dibuka;
- confirmation menampilkan nama jadwal, jumlah belum mulai, jumlah session aktif, dan akibat bahwa start/save baru akan ditolak;
- alasan wajib; request membawa expected schedule version dan idempotency key;
- session aktif difinalisasi bertahap dari answer terakhir yang sudah committed;
- UI menampilkan progress finalisasi sampai active count menjadi nol;
- action serta setiap finalization cause tercatat dalam audit.

---

## 11. Halaman peserta

### 11.1 Dashboard peserta

Ujian dikelompokkan:

- Sedang berlangsung;
- Akan datang;
- Selesai;
- Hasil tersedia.

Exam card menampilkan:

- judul;
- subject;
- tanggal dan waktu lengkap;
- duration;
- status;
- tombol sesuai state.

Tombol:

- “Mulai Ujian” jika boleh start;
- badge **Attempt baru tersedia** ditampilkan di atas tombol **Mulai Ujian** ketika admin telah mereset attempt dan server mengembalikan eligibility `ATTEMPT_RESET_AVAILABLE`; tombol yang sama aktif kembali, bukan tombol jenis baru;
- “Lanjutkan Ujian” jika session active;
- “Belum Dimulai” disabled dengan waktu;
- “Lihat Hasil” jika released;
- tidak ada tombol start kedua setelah attempt digunakan, kecuali reset attempt resmi membuat eligibility baru.

Badge **Attempt baru tersedia** hilang hanya setelah pembuatan session pengganti berhasil. Jika request start gagal atau outcome belum diketahui, badge tetap tampil sampai UI memeriksa eligibility/session authoritative dari server.

### 11.2 Pre-exam screen

Sebelum start:

- identitas peserta;
- nama ujian;
- jumlah soal;
- duration;
- window;
- aturan autosave dan hard deadline;
- pemeriksaan koneksi sederhana;
- checkbox acknowledgement hanya bila sekolah memerlukannya;
- primary button “Mulai Ujian”.

Server baru membuat session saat tombol start dikirim. Loading start tidak boleh memungkinkan double click.

### 11.3 Loading ketika memulai ujian

Setelah tombol “Mulai Ujian” ditekan:

~~~text
┌──────────────────────────────────────┐
│        Menyiapkan ujian…             │
│  Soal dan waktu sedang disiapkan.    │
│  Jangan tutup halaman ini.           │
│             [spinner]                │
└──────────────────────────────────────┘
~~~

Aturan waktu:

- 0–3 detik: spinner dan “Menyiapkan ujian…”;
- setelah 3 detik: tambahkan “Proses masih berjalan” tanpa menganggap gagal;
- setelah 15 detik tanpa outcome: tampilkan “Persiapan lebih lama dari biasanya” serta action “Periksa status”;
- action tersebut membaca/resume session dan memakai start idempotency key yang sama, bukan membuat request start baru;
- button start tetap disabled sampai outcome diketahui;
- route unload warning aktif setelah request start terkirim;
- network failure mempertahankan idempotency key dan mencoba status lookup ketika online;
- bila session ternyata sudah dibuat, UI langsung resume;
- validation/eligibility error kembali ke pre-exam dengan pesan yang dapat ditindaklanjuti;
- focus dipindahkan ke heading status dan aria-live polite mengumumkan perubahan tahap.

---

## 12. Halaman ujian peserta

Halaman ini mempunyai prioritas usability tertinggi.

### 12.1 Desktop wireframe

~~~text
┌──────────────────────────────────────────────────────────────────────┐
│ GezyCBT | Matematika        ● Tersimpan       Sisa waktu 01:12:34   │
├───────────────────────────────────────────────┬──────────────────────┤
│ Soal 12 dari 50             [Tandai]          │ Daftar Soal          │
│                                               │ 01 02 03 04 05       │
│ ┌───────────────────────────────────────────┐ │ 06 07 08 09 10       │
│ │ Stimulus / gambar                        │ │ ...                  │
│ └───────────────────────────────────────────┘ │                      │
│                                               │ ○ Belum dijawab      │
│ Pertanyaan                                    │ ● Sudah dijawab      │
│                                               │ ⚑ Ditandai           │
│ ○ A. Opsi pertama                             │                      │
│ ○ B. Opsi kedua                               │ [Kumpulkan Ujian]    │
│ ○ C. Opsi ketiga                              │                      │
│                                               │                      │
├───────────────────────────────────────────────┴──────────────────────┤
│ [Sebelumnya]                                      [Berikutnya]       │
└──────────────────────────────────────────────────────────────────────┘
~~~

Layout:

- header sticky;
- main question max-width 880 px;
- palette width 280–320 px;
- navigation footer/sticky action berada dalam viewport;
- stimulus dan question mempunyai ruang jelas;
- tidak ada nested page scroll kecuali palette bila panjang.

### 12.2 Mobile wireframe

~~~text
┌───────────────────────────────┐
│ Soal 12/50   01:12:34   [☰]  │
│ ● Tersimpan                   │
├───────────────────────────────┤
│ [Tandai soal]                 │
│                               │
│ Stimulus / gambar             │
│                               │
│ Pertanyaan                    │
│                               │
│ ○ A. Opsi pertama             │
│ ○ B. Opsi kedua               │
│ ○ C. Opsi ketiga              │
│                               │
│                               │
├───────────────────────────────┤
│ [Sebelumnya]     [Berikutnya] │
└───────────────────────────────┘
~~~

- palette dibuka melalui drawer;
- header dapat membungkus status simpan ke baris kedua;
- bottom navigation sticky;
- content diberi padding bawah agar tidak tertutup navigation;
- timer memakai tabular numerals;
- touch target minimal 44 px;
- option card seluruhnya dapat ditekan.

### 12.3 Header ujian

Isi:

- nomor soal/progress;
- judul singkat pada desktop;
- connectivity;
- save status;
- timer;
- tombol palette pada mobile.

Save status:

| State | Label |
|---|---|
| READY | “Tersimpan” + check icon |
| DIRTY | “Belum tersimpan” + dot |
| SAVING | “Menyimpan…” + spinner kecil |
| OFFLINE_DIRTY | “Offline — tersimpan di perangkat” |
| CONFLICT | “Perlu sinkronisasi” |
| FINALIZING | “Mengumpulkan ujian…” |
| ENDED | “Sesi diakhiri” — final state visual setelah server mengembalikan `SESSION_ENDED`; bukan bagian dari siklus save normal |

Pada state `ENDED`, input jawaban dinonaktifkan, pengiriman outbox dihentikan, dan UI mengambil final state. Detail label mengikuti `finalization_reason` pada section 7.7.

### 12.4 Timer

- server deadline authoritative;
- >10 menit: warna teks normal;
- ≤10 menit: warning + label “Waktu hampir habis” pada perubahan threshold;
- ≤5 menit: danger;
- tidak berkedip;
- screen reader announcement tidak dilakukan setiap detik;
- announcement diberikan pada threshold penting;
- waktu tidak boleh hanya direpresentasikan progress circle.

### 12.5 Stimulus

- background dapat sedikit berbeda dari question area;
- teks mempertahankan paragraph/list;
- gambar responsive;
- click/tap membuka image viewer;
- viewer mendukung zoom dan close keyboard;
- alt text digunakan bila tersedia;
- tidak ada horizontal scroll halaman.

### 12.6 Option card

Option:

- border default Slate 200;
- hover Slate 100/Primary 50;
- selected memakai Primary 50, Primary 600 border, dan checked control;
- focus ring jelas;
- disabled tetap terbaca;
- label A/B/C bukan satu-satunya accessible name.

### 12.7 SINGLE_CHOICE

- semantic radio group;
- satu pilihan mengganti pilihan sebelumnya;
- memilih label/card memperbarui radio;
- jawaban dapat diubah sampai submit/deadline;
- keyboard arrow dapat berpindah antaroption.

### 12.8 MULTIPLE_RESPONSE

- semantic checkbox group;
- instruksi terlihat: “Pilih satu atau lebih jawaban. Nilai diberikan jika seluruh pilihan tepat.”;
- tidak menampilkan jumlah jawaban benar;
- pilihan dapat dihapus;
- exact-match rule dijelaskan tanpa membocorkan key.

### 12.9 TRUE_FALSE

Tepat tiga statement:

~~~text
1. Pernyataan pertama
   ( ) Benar    ( ) Salah

2. Pernyataan kedua
   ( ) Benar    ( ) Salah

3. Pernyataan ketiga
   ( ) Benar    ( ) Salah
~~~

Pada mobile, Benar/Salah tetap sejajar jika cukup lebar atau menjadi segmented control lebar penuh. Belum dijawab tampil berbeda dari Salah.

### 12.10 Question palette

Status:

- current: ring biru tebal dan aria-current;
- answered: filled Primary 600 dengan teks putih;
- unanswered: putih dengan border Slate 300;
- marked: icon/marker amber;
- current+marked: current ring ditambah marker;
- conflict/unsynced: dot warning kecil bila perlu.

Nomor tetap terbaca pada semua status. Legend tampil pada drawer/sidebar.

### 12.11 Navigasi

- Sebelumnya disabled pada soal pertama;
- Berikutnya berubah menjadi “Tinjau & Kumpulkan” pada soal terakhir;
- jawaban lokal ditulis sebelum navigasi;
- navigasi tidak menunggu network bila outbox sudah aman;
- keyboard shortcut tidak wajib pada MVP; jika ada, jangan bentrok dengan input.

#### Future keyboard shortcut policy

MVP selalu menyediakan button dan native form control; tidak ada fungsi ujian yang hanya dapat dijalankan melalui shortcut. Jika shortcut ditambahkan kemudian:

- hindari single-character shortcut agar tidak terpicu oleh speech input dan tidak menambah kewajiban remap/disable;
- shortcut tidak aktif ketika focus berada pada input, textarea, select, contenteditable, option group, dialog, atau drawer;
- jangan mengambil kombinasi umum browser/OS/screen reader sebelum diuji pada browser yang didukung;
- shortcut untuk pindah soal tetap menjalankan penyimpanan lokal dan focus management yang sama dengan button;
- jangan menyediakan shortcut langsung untuk submit atau destructive action;
- daftar shortcut tersedia melalui menu bantuan dan dapat dinonaktifkan pengguna;
- activation memberi announcement yang sama dengan action biasa, tanpa announcement ganda;
- perubahan shortcut wajib melalui keyboard, screen-reader, dan cross-browser test sebelum dirilis.

### 12.12 Offline

Banner:

~~~text
Anda sedang offline. Jawaban disimpan di perangkat dan akan dikirim
saat koneksi kembali. Jangan menghapus data browser.
~~~

- banner tidak menutupi timer atau navigation;
- option tetap dapat dipilih;
- submit tidak mengklaim selesai sebelum server merespons;
- reconnect/sync progress terlihat;
- konflik menawarkan reload server state atau retry sesuai rules.

### 12.13 Submit

Dialog submit menampilkan:

- jumlah seluruh soal;
- sudah dijawab;
- belum dijawab;
- ditandai;
- pending/unsynced answers;
- sisa waktu;
- penjelasan bahwa jawaban tidak dapat diubah setelah submit.

#### Submit dengan unsynced answers

Jika masih ada unsynced answer, request submit menyertakannya sebagai `finalAnswers`, masing-masing dengan `baseVersion`. UI tidak menjalankan atau menunggu request sync terpisah; submit itu sendiri menjadi final sync dan finalisasi dalam satu transaction server. Submit button menggunakan state loading dan idempotency. Double click tidak menghasilkan submit kedua.

Pending outbox baru dihapus setelah server mengembalikan final outcome. Bila response hilang, UI memeriksa state session lalu mengulang payload dan idempotency key yang sama hanya jika session masih aktif.

#### Retry dan kegagalan submit

| Kondisi | UI | Tindakan |
|---|---|---|
| Network timeout/terputus | “Koneksi terputus. Jawaban yang belum terkirim tetap aman di perangkat; waktu ujian tetap berjalan.” | Cek state session; retry otomatis terbatas dan tombol **Coba Lagi** memakai key/payload sama jika masih active |
| 503/service busy | “Server sedang sibuk. Mencoba lagi…” + countdown | Ikuti `Retry-After` atau exponential backoff; sediakan **Coba Lagi** |
| 409 answer conflict | “Jawaban berubah di perangkat lain.” | Tampilkan state authoritative dan pending local, minta peserta menyelesaikan pilihan, lalu submit ulang dengan version terkini dan idempotency key baru sebelum deadline |
| 401 auth expired | “Sesi login berakhir. Masuk ulang untuk melanjutkan.” | Pertahankan outbox, login ulang, resume session yang sama, lalu lanjutkan |
| `SESSION_ENDED` | Petakan `finalizationReason` aman menjadi “Sesi diakhiri petugas”, “Jadwal telah ditutup”, atau “Attempt telah direset” | Hentikan pengiriman outbox, ambil final state, lalu arahkan ke konfirmasi/hasil sesuai release policy |
| Session sudah final | Confirmation final | Jangan retry; arahkan ke halaman hasil/status |
| Deadline lewat | “Waktu habis. Sistem menilai jawaban terakhir yang sudah diterima server.” | Jangan mengirim pending local answer; jalankan/baca timeout finalization dan tampilkan final state |
| Validation error | Jelaskan item yang tidak valid | Tidak auto-retry; perbaiki/reload manifest sesuai error |
| Error tidak dikenal | Request ID dan “Periksa status” | Query session sebelum menawarkan retry |

UI tidak pernah mengatakan “Ujian gagal dikumpulkan” hanya karena response hilang; outcome harus diperiksa ke server. Retry otomatis dibatasi dan memakai exponential backoff. Retry untuk payload dengan outcome yang belum diketahui memakai idempotency key yang sama. Response `409` memastikan payload tersebut tidak difinalisasi; setelah reconciliation mengubah payload/version, submit berikutnya memakai key baru.

Peserta hanya menerima `finalizationReason` yang aman. `finalization_note`, alasan bebas yang diketik staf, dan metadata audit tidak boleh berada dalam participant response, DOM, telemetry frontend, atau IndexedDB.

### 12.14 Timeout

Saat deadline:

- input dinonaktifkan;
- status berubah menjadi finalizing;
- server finalization dipanggil;
- tampilkan progress yang tenang;
- jika response tertunda, jelaskan bahwa jawaban acknowledged tetap tersimpan;
- setelah final, arahkan ke confirmation/result sesuai policy.

### 12.15 Multi-tab/device

UI memberi warning jika mendeteksi tab lain. Jika version conflict terjadi:

- jangan menimpa diam-diam;
- tampilkan status sinkronisasi;
- ambil server state;
- jelaskan bila session sudah submit/final pada perangkat lain.

### 12.16 Focus management saat navigasi soal

Ketika peserta memilih “Berikutnya”, “Sebelumnya”, atau nomor palette:

1. state jawaban lokal disimpan terlebih dahulu;
2. route/view soal berubah;
3. focus dipindahkan ke heading tersembunyi/terlihat “Soal N dari Total” dengan `tabindex="-1"`;
4. screen reader mengumumkan nomor soal dan status dijawab/ditandai;
5. pengguna kemudian dapat Tab menuju tombol Tandai, stimulus, lalu option group.

Focus tidak langsung dipindahkan ke opsi pertama karena dapat membingungkan dan berisiko mengubah radio melalui keyboard. Jika navigasi dipicu oleh error/validation action, focus boleh menuju field/option group yang bermasalah dengan heading context diumumkan lebih dahulu.

Membuka palette memindahkan focus ke current question button. Menutup palette mengembalikan focus ke button pembuka. Setelah submit dialog dibatalkan, focus kembali ke “Kumpulkan Ujian”.

### 12.17 Auth session expired saat ujian

Untuk peserta utama, expiry login tidak menghapus exam page atau IndexedDB outbox.

~~~text
┌ Sesi login berakhir ───────────────────────────┐
│ Ujian Anda masih berjalan dan waktu tetap      │
│ berjalan. Masuk kembali untuk menyinkronkan.   │
│                                                │
│ Username [________________]                    │
│ Password [________________]                    │
│                         [Masuk dan Lanjutkan]  │
└────────────────────────────────────────────────┘
~~~

Aturan:

- option editing boleh dihentikan sementara agar ownership dapat diverifikasi kembali;
- manifest, jawaban lokal, dan pending outbox tidak dibersihkan;
- timer tetap memakai deadline terakhir dan terus berjalan;
- credential lama tidak dipakai untuk request baru;
- setelah login, server memeriksa bahwa user memiliki session tersebut;
- frontend menjalankan resume/reconciliation sebelum mengirim pending mutation;
- bila deadline sudah lewat, flow berpindah ke finalization;
- bila account disabled atau ownership gagal, tampilkan error aman dan jangan mengirim outbox ke user lain;
- username dapat diprefill secara aman, password selalu kosong;
- practice guest tidak memakai flow login ini; kehilangan practice cookie mengikuti batas recovery practice.

---

## 13. Halaman hasil

### 13.1 Ujian utama

Sebelum release:

- icon success;
- “Ujian berhasil dikumpulkan”;
- submitted time;
- status “Hasil belum dirilis”;
- kembali ke dashboard.

Setelah release:

- nilai;
- earned/max score;
- percentage;
- correct/incorrect/unanswered jika policy mengizinkan;
- tidak menampilkan answer key pada baseline.

### 13.2 Latihan

Nilai langsung terlihat setelah submit, tanpa answer key. Halaman menampilkan:

- earned score dan maximum score;
- percentage;
- jumlah benar, salah, dan belum dijawab;
- waktu selesai;
- identitas snapshot ringkas agar peserta mengetahui hasil tersebut miliknya;
- penjelasan bahwa jawaban benar/answer key tidak ditampilkan.

Baseline tidak menampilkan status benar/salah per soal, opsi yang benar, atau pembahasan. Karena latihan dapat diulang, detail per soal dapat dipakai untuk menebak answer key. Fitur review per soal hanya dapat ditambahkan kemudian dengan result policy dan threat review tersendiri.

Response server memberi `canRetry` dan `canRetryReason`. Jika `canRetry=true`, `canRetryReason` bernilai null dan UI menampilkan CTA **Coba Lagi** yang membuat session baru setelah token/schedule diperiksa kembali. Jika false, CTA tidak ditampilkan dan UI memakai pemetaan berikut:

| `canRetryReason` | Pesan UI |
|---|---|
| `SCHEDULE_CLOSED` | Jadwal latihan telah ditutup. |
| `ATTEMPT_LIMIT_REACHED` | Batas percobaan telah tercapai. |
| `TOKEN_INVALID_OR_EXPIRED` | Token latihan tidak lagi berlaku. Minta token terbaru kepada guru. |
| Nilai tidak dikenal | Latihan belum dapat diulang. |

UI tidak menyimpulkan izin retry hanya dari waktu lokal dan tidak menampilkan CTA berdasarkan enum saja bila `canRetry` bernilai false.

### 13.3 Print

GezyCBT tidak menyediakan tombol cetak atau layout cetak khusus pada MVP. Tampilan hasil di browser tidak dijamin rapi ketika pengguna menjalankan `Ctrl+P` atau fitur print browser.

Halaman hasil peserta tidak mendukung print. Untuk data resmi, staf menggunakan export server yang download-nya diaudit. Format awal adalah CSV untuk pengolahan data. Jika sekolah membutuhkan dokumen siap cetak, format PDF dibuat sebagai fitur/template report tersendiri setelah MVP; browser print tetap tidak menjadi jalur resmi. Halaman peserta menampilkan keterangan “Cetak dari browser belum didukung” jika kebutuhan ini perlu dijelaskan.

---

## 14. State dan feedback global

Setiap feature wajib merancang:

- initial;
- loading;
- success;
- empty;
- validation error;
- authorization denied;
- not found;
- network error;
- server error;
- stale/conflict;
- disabled/read-only;
- destructive confirmation.

### 14.1 Error page

| Status | Pesan pengguna |
|---|---|
| 403 | “Anda tidak memiliki akses ke halaman ini.” |
| 404 | “Halaman atau data tidak ditemukan.” |
| 409 | “Data telah berubah. Muat ulang sebelum melanjutkan.” |
| 429 | “Terlalu banyak permintaan. Coba lagi sebentar.” |
| 500 | “Terjadi gangguan. Coba lagi atau hubungi admin.” |

Request ID ditampilkan kecil dan dapat disalin.

### 14.2 Unsaved changes

Editor staf menampilkan status:

- Belum ada perubahan;
- Ada perubahan belum disimpan;
- Menyimpan;
- Tersimpan;
- Gagal menyimpan.

Navigasi meninggalkan form dengan perubahan belum disimpan memunculkan confirmation. Autosave hanya digunakan pada area yang memang dirancang untuknya.

### 14.3 Vue error boundary

Error komponen tidak selalu boleh menjatuhkan seluruh halaman. Boundary diterapkan pada tiga tingkat:

| Tingkat | Contoh | Perilaku |
|---|---|---|
| Route group | shell admin, guru, peserta, latihan | Error satu area menampilkan fallback area tersebut tanpa merusak state area lain |
| Section/widget | chart, ringkasan, preview media, panel sekunder | Hanya section tersebut diganti panel error; navigation dan section lain tetap berfungsi |
| Route/page | data utama atau shell route gagal | Tampilkan full-page recovery dengan **Coba Lagi**, **Muat Ulang**, kembali ke halaman aman, dan request ID |

Aturan khusus halaman ujian:

- header, timer, status koneksi, outbox, navigasi, dan tombol bantuan berada di luar boundary renderer soal;
- kegagalan renderer satu soal menampilkan panel “Soal tidak dapat ditampilkan” dengan retry dan request ID tanpa menghapus jawaban lokal;
- peserta tidak boleh diminta submit sebelum renderer pulih atau server menyatakan sesi harus ditutup;
- bila manifest utama rusak, tampilkan recovery page yang menawarkan “Coba muat kembali” dan “Kembali ke sesi”, lalu lakukan resume dari server;
- error boundary tidak membersihkan IndexedDB outbox, tidak mengubah deadline, dan tidak menganggap jawaban sudah tersimpan;
- telemetry error hanya mengirim route, component name, error code, request ID, dan stack yang disanitasi; isi soal, jawaban, token, serta identitas tidak ikut dikirim.

Setelah retry berhasil, focus kembali ke heading section yang pulih. Error berulang memakai pesan stabil dan tidak memunculkan toast tanpa henti.

### 14.4 Empty state

Empty state membedakan data memang belum ada dari data tidak ditemukan karena filter.

| Konteks | Pesan dan tindakan |
|---|---|
| Exam revision belum memiliki soal | “Belum ada soal dalam ujian ini.” CTA **Tambahkan Soal**; tombol publish disabled dan readiness menampilkan error |
| Bank soal benar-benar kosong | Penjelasan singkat dan CTA **Buat Soal** atau **Import Soal** sesuai izin |
| Hasil filter kosong | “Tidak ada data yang cocok.” CTA **Reset Filter**; jangan menawarkan membuat data baru sebagai tindakan utama |
| Jadwal belum mempunyai peserta eligible | Tampilkan penyebab scope/target dan CTA memperbaiki target sebelum publish/activate |
| Palette sebelum sesi berhasil dibuat | Skeleton/loading, bukan empty state |
| Palette sesi aktif berisi nol soal | Perlakukan sebagai data/runtime error; hentikan pengerjaan, pertahankan outbox, tampilkan retry dan request ID |

Empty state tidak memakai ilustrasi besar pada halaman ujian. Pada admin/guru, ilustrasi bersifat optional dan tidak boleh mendorong primary action ke bawah fold ponsel.

---

## 15. Bahasa dan content design

### 15.1 Label

Gunakan kata kerja spesifik:

- “Buat Soal”;
- “Simpan Draft”;
- “Validasi”;
- “Terbitkan Revisi”;
- “Buat Jadwal”;
- “Kumpulkan Ujian”;
- “Unduh Hasil”.

Hindari label generik “OK”, “Ya”, atau “Proses” bila tindakan dapat disebutkan.

### 15.2 Confirmation

Confirmation menyebut:

- object;
- jumlah data terdampak;
- akibat;
- apakah dapat dibatalkan;
- primary action spesifik.

Contoh: “Rilis hasil Matematika IX-A kepada 32 peserta? Setelah dirilis, peserta dapat melihat nilai.”

### 15.3 Date, time, number

- locale Bahasa Indonesia;
- zona Asia/Jakarta;
- tanggal: “16 September 2026”;
- waktu: “08.00 WIB”;
- date-time: “16 September 2026, 08.00 WIB”;
- nilai desimal mengikuti format yang konsisten;
- duration ditulis “90 menit”;
- relative time hanya sebagai pelengkap, bukan pengganti timestamp penting.

### 15.4 Istilah UI

| Domain/API | UI |
|---|---|
| Participant | Peserta |
| Teacher | Guru |
| Question bank | Bank Soal |
| Question revision | Revisi Soal |
| Exam | Ujian |
| Schedule | Jadwal |
| Exam session | Sesi Ujian |
| Result | Hasil |
| Published | Diterbitkan |
| Archived | Diarsipkan |
| Exact match | Semua pilihan harus tepat |

---

## 16. Accessibility

Target minimum adalah WCAG 2.2 AA untuk flow kritis.

### 16.1 Keyboard

- semua action dapat digunakan keyboard;
- focus order mengikuti visual order;
- focus indicator tidak dihapus;
- skip link menuju main content;
- modal/drawer mempunyai focus trap dan return focus;
- drag-and-drop mempunyai alternatif button/keyboard;
- Escape menutup overlay yang aman ditutup.

#### Focus management policy

| Peristiwa | Tujuan focus |
|---|---|
| Navigasi route biasa | Heading utama/H1 atau awal `main` dengan `tabindex="-1"` |
| Navigasi soal | Heading “Soal N dari M” dengan `tabindex="-1"` |
| Modal/drawer dibuka | Elemen interaktif pertama yang bermakna; untuk destructive confirmation pilih aksi aman |
| Modal/drawer ditutup | Trigger yang membukanya; bila trigger hilang, elemen logis terdekat |
| Toast muncul | Focus tidak berpindah |
| Satu validation error | Field invalid pertama |
| Beberapa validation error | Error summary mendapat focus; link summary memindahkan focus ke field terkait |
| Section pulih setelah retry | Heading section yang baru pulih |

Perpindahan focus programmatic tidak memakai animasi scroll jika pengguna memilih reduced motion. Elemen dengan `tabindex="-1"` hanya menerima focus programmatic dan tidak masuk urutan Tab normal.

### 16.2 Semantic HTML

- landmark header/nav/main/footer;
- heading hierarchy tidak meloncat tanpa alasan;
- button untuk action, link untuk navigation;
- table memakai caption/header yang benar;
- fieldset/legend untuk option group;
- radio/checkbox native dipertahankan atau direplikasi secara lengkap;
- region `aria-live` dibuat tetap di DOM agar pembaca layar menerima perubahan; jangan membuat region baru untuk setiap pesan;
- pesan yang terlihat secara visual tetap menggunakan semantic element dan association yang sesuai, bukan mengandalkan live region saja.

#### Matriks aria-live

| Peristiwa | Mode | Aturan pengumuman |
|---|---|---|
| Jawaban sedang disimpan/tersimpan | `polite` | Gabungkan perubahan cepat; umumkan hasil akhir, bukan setiap keystroke atau setiap autosave |
| Gagal menyimpan | `assertive` sekali | Umumkan bahwa jawaban masih tersimpan di perangkat dan tindakan berikutnya |
| Koneksi offline | `assertive` sekali | Umumkan saat transisi online ke offline; jangan diulang selama tetap offline |
| Koneksi pulih | `polite` sekali | Umumkan proses sinkronisasi, lalu “Semua jawaban tersimpan” bila sudah acknowledged |
| Pindah soal | Tidak memakai live region | Focus programmatic pada heading “Soal N dari M” menjadi announcement; jangan menduplikasinya |
| Sisa 10 menit | `polite` sekali | Tidak diulang oleh tick timer |
| Sisa 5 menit dan 1 menit | `assertive` sekali per ambang | Satu announcement untuk setiap threshold |
| Waktu habis | `assertive` sekali | Umumkan bahwa sistem sedang mengumpulkan ujian |
| Waktu ditambah | `polite` sekali | Sebutkan tambahan menit dan deadline baru |
| Start exam masih menyiapkan | `polite` | Umumkan perubahan tahap setelah 3 detik; jangan membaca spinner |
| Submit/finalisasi berjalan | `polite` | Satu announcement ketika tahap berubah |
| Submit berhasil | Tidak memakai live region | Navigasi memindahkan focus ke heading konfirmasi sehingga pesan tidak dibaca dua kali |
| Ringkasan error form | `polite` | Focus summary/field menjadi mekanisme utama; live region hanya dipakai bila pesan berubah tanpa perpindahan focus |
| Polling monitoring staf | Tidak memakai live region | Update tabel latar belakang tidak boleh mengganggu pembaca layar; pengguna dapat memicu refresh manual |
| Toast sukses biasa | `role="status"` (`polite`) | Hanya tindakan yang dipicu pengguna; focus tidak berpindah |
| Toast error yang perlu tindakan | `role="alert"` (`assertive`) | Hanya untuk error unik; hindari duplikasi bila form atau boundary sudah mengumumkannya |

Gunakan region polite dan assertive terpisah. Pesan identik yang berulang di-deduplikasi. Timer visual boleh berubah setiap detik, tetapi accessible text hanya berubah pada threshold di atas.

### 16.3 Visual

- kontras AA;
- zoom 200%;
- text resize tidak memotong;
- icon tidak menjadi satu-satunya label;
- touch target mengikuti policy: 44 × 44 px untuk peserta/coarse pointer, 40 px default staf desktop, dan 36 px hanya untuk kontrol compact yang memenuhi syarat;
- status tidak hanya warna;
- error field mempunyai text dan programmatic association;
- image penting mempunyai alt text.

### 16.4 Screen reader pada ujian

- nomor dan total soal diumumkan saat navigasi;
- timer tidak diumumkan setiap detik;
- perubahan save status menggunakan polite announcement;
- offline dan deadline threshold diumumkan;
- option group mempunyai question/statement context;
- palette button mempunyai label status per nomor.

Deadline announcement di-deduplikasi per session dan nilai deadline authoritative. Runtime mencatat threshold yang sudah diumumkan (`10m`, `5m`, `1m`, `0`) pada metadata lokal session dan menyelaraskannya antar-tab melalui `BroadcastChannel` bila tersedia.

Ketika tab kembali visible:

- timer dihitung ulang lebih dahulu dari server offset/deadline terakhir;
- threshold yang sudah diumumkan tidak dibaca ulang;
- bila beberapa threshold terlewati saat tab hidden, umumkan hanya threshold terdekat dengan sisa waktu sekarang—misalnya kembali pada sisa 4 menit hanya mengumumkan ambang 5 menit—lalu tandai ambang yang lebih awal sebagai terlewati; bila waktu sudah habis, hanya umumkan ambang 0;
- rerender, pergantian theme, membuka palette, atau reconnect tidak me-reset dedup state;
- jika time extension menghasilkan deadline baru yang kembali berada di atas suatu threshold, deadline baru memulai announcement cycle baru untuk threshold yang memang akan dilewati lagi; banner time extension tetap diumumkan terpisah satu kali.

---

## 17. Performance UI

### 17.1 Bundle

- route admin, guru, peserta, dan latihan di-lazy-load;
- halaman ujian tidak memuat editor, chart, atau admin table library;
- icon di-tree-shake;
- system font menghindari font download;
- chart library hanya dimuat pada halaman yang memakainya;
- image thumbnail memakai ukuran yang sesuai.

### 17.2 Rendering

- list/table panjang memakai server pagination;
- jangan me-render 1.500 user sekaligus;
- question palette 100 item masih dapat dirender sederhana;
- resize/orientation tidak menghitung ulang state domain;
- avoid layout shift pada image dengan known aspect/size;
- editor long text tidak membuat seluruh page rerender setiap keystroke.

### 17.3 Network

- filter search remote menggunakan debounce;
- monitoring polling memakai jitter;
- exam autosave change-driven dan batch;
- button mutation mencegah duplicate click;
- loading dan retry state terlihat;
- static asset memiliki content hash.

---

## 18. Struktur komponen frontend

Struktur konseptual:

~~~text
components/
  primitives/
    AppButton
    AppInput
    AppSelect
    AppCheckbox
    AppRadio
    AppBadge
    AppAlert
    AppModal
    AppDrawer
    AppTable
  layout/
    StaffSidebar
    StaffTopbar
    StaffFooter
    ParticipantHeader
    PageHeader
  feedback/
    LoadingSkeleton
    EmptyState
    ErrorState
    SaveStatus
    ConnectivityStatus
  exam/
    ExamHeader
    ExamTimer
    QuestionRenderer
    SingleChoiceQuestion
    MultipleResponseQuestion
    TrueFalseQuestion
    QuestionPalette
    ExamNavigation
    SubmitSummary
~~~

Aturan:

- primitives tidak mengetahui domain;
- feature component boleh mengetahui contract domain;
- participant renderer tidak menerima answer key;
- editor preview memakai safe mapping;
- komponen tidak memanggil API secara tersembunyi tanpa feature/service owner;
- design token dipakai oleh seluruh komponen.

---

## 19. Validasi desain sebelum implementation penuh

Prototype wajib dibuat untuk:

1. login peserta pada ponsel;
2. dashboard peserta;
3. tiga tipe soal;
4. offline/reconnecting state;
5. submit summary;
6. question editor guru;
7. exam editor dengan question picker;
8. result table desktop/mobile;
9. user management/import admin.

Setiap prototipe diuji pada light theme, dark theme, dan mode `prefers-color-scheme`; perubahan theme tidak boleh mengubah state, focus, atau hasil interaction.

Perangkat/viewport minimum:

- 360 × 800;
- 390 × 844;
- 768 × 1024;
- 1024 × 768;
- 1366 × 768;
- 1440 × 900.

Uji perangkat nyata sebelum pilot:

- Chrome Android;
- Safari iOS yang tersedia di sekolah;
- Chrome/Edge desktop;
- keyboard-only desktop;
- koneksi throttled dan offline.

---

## 20. Acceptance criteria UI/UX

### Global

- tidak ada horizontal page scroll pada viewport 360 px;
- seluruh action penting dapat digunakan keyboard;
- focus ring terlihat;
- touch target peserta/mobile minimal 44 px; staf desktop mengikuti touch target policy;
- halaman mempunyai loading, empty, error, dan success state;
- warna dan spacing memakai token;
- theme default mengikuti sistem serta pilihan Terang/Gelap bertahan setelah reload tanpa flash yang mengganggu;
- seluruh flow kritis lulus pemeriksaan kontras dan visual pada light serta dark theme;
- UI tidak membocorkan field terlarang;
- role menu sesuai izin, sementara backend tetap mengotorisasi;
- date/time konsisten Asia/Jakarta;
- tidak ada destructive action tanpa impact confirmation.

### Admin/guru

- sidebar desktop dan drawer mobile berfungsi;
- table mempunyai pagination dan mobile strategy;
- form panjang terbagi menjadi section;
- validation mengarahkan ke field;
- menu dan route mengikuti role/effective scope; deep link terlarang menampilkan 403;
- scope subject/class tersimpan di URL dan perubahan scope me-reset filter yang tidak kompatibel;
- readiness report mengelompokkan issue, menautkan error ke field, dan memblokir publish saat ada error;
- import 1.500 row tetap responsif melalui pagination; blocking error menonaktifkan commit dan error export tidak memuat credential;
- import yang sudah committed menampilkan hasil read-only dan tidak pernah mengaktifkan commit ulang;
- media editor mempunyai progress, retry, alt validation, dan tidak dapat menghapus asset yang direferensikan published revision;
- question picker menangani 100+ soal tanpa duplicate serta dapat reorder/hapus dengan keyboard;
- unsaved state terlihat;
- publish/release/export menampilkan impact;
- monitoring 1.000 peserta memakai server pagination, dapat dipause, dan menunjukkan data stale;
- session detail drawer menampilkan progress/last activity tanpa raw answer dan menyediakan action sesuai izin;
- release/unrelease dapat menargetkan subset atau seluruh filter dengan impact confirmation;
- export history memperlihatkan status sampai READY, FAILED, atau EXPIRED;
- Perpanjang Waktu, Akhiri Sesi, reset attempt, dan Tutup Jadwal mempunyai target yang jelas, meminta alasan sesuai policy, serta memperlihatkan dampak;
- label akhir session mengikuti `finalization_reason`, sedangkan status rilis hasil tetap ditampilkan terpisah;
- schedule MAIN/PRACTICE hanya memperlihatkan kode plaintext sekali; kunjungan berikutnya menampilkan hint tersamarkan;
- credential integration hanya tampil sekali.

### Peserta

- login dan dashboard berfungsi pada 360 px;
- layout ujian tidak memakai sidebar/footer;
- tiga renderer dapat digunakan touch dan keyboard;
- timer, save, dan connectivity selalu dapat ditemukan;
- UI tidak mengklaim saved sebelum acknowledgment;
- offline answer tetap dapat diubah;
- refresh/resume tidak membingungkan;
- submit mencegah double action;
- kegagalan submit membedakan network, 503, 409, 401, dan final state tanpa membuat submit ganda;
- auth expiry dapat dipulihkan tanpa menghapus outbox dan tanpa menghentikan deadline server;
- reset attempt menampilkan badge “Attempt baru tersedia” dan mengaktifkan kembali start hanya berdasarkan eligibility server;
- badge reset attempt tetap tampil sampai pembuatan replacement session benar-benar berhasil;
- perpindahan soal memindahkan focus ke heading soal;
- timeout mempunyai finalizing state;
- hasil latihan menampilkan aggregate benar/salah/kosong tanpa answer key atau correctness per soal;
- CTA latihan ulang hanya tampil ketika `canRetry` server bernilai true;
- result visibility mengikuti policy server.

### Accessibility

- automated accessibility test lulus untuk flow utama;
- manual keyboard test lulus;
- screen-reader smoke test pada login, satu soal tiap tipe, navigation, dan submit;
- announcement penting mengikuti matriks aria-live dan tidak berulang pada setiap tick/poll;
- deadline threshold tidak diumumkan ulang setelah tab hidden/visible atau rerender;
- contrast AA;
- reduced-motion berfungsi;
- zoom 200% tidak menghilangkan fungsi.

---

## 21. Keputusan yang sengaja ditunda

Hal berikut ditentukan setelah prototype dan pengujian pengguna:

- ilustrasi login final;
- icon family/package final;
- apakah sidebar default expanded atau collapsed pada tablet tertentu;
- density table compact sebagai user preference;
- visual chart final;
- print stylesheet;
- custom primary color per sekolah;
- rich-text toolbar final;
- advanced equation editor.

Penundaan ini tidak menghalangi implementation karena warna dasar, spacing, typography, layout, state, responsive behavior, dan komponen kritis sudah mempunyai baseline.

---

## 22. Definition of done halaman

Sebuah halaman belum selesai sebelum:

- tujuan dan primary action jelas;
- desktop/mobile behavior tersedia;
- loading/empty/error/denied/conflict state tersedia;
- keyboard dan focus flow diperiksa;
- API error dipetakan menjadi pesan yang dapat ditindaklanjuti;
- date/time dan number formatting benar;
- responsive screenshot atau visual test tersedia;
- tidak ada sensitive data pada DOM/log yang tidak dibutuhkan;
- critical action mempunyai loading/idempotent UI;
- analytics/telemetry tidak menyimpan jawaban atau PII mentah;
- reviewer membandingkan hasil dengan dokumen ini.

## Batas rancangan

Dokumen ini adalah visual and interaction baseline, bukan file desain pixel-perfect. Nilai dapat disempurnakan setelah prototype diuji, tetapi perubahan pada navigasi utama, exam layout, semantic colors, accessibility, atau reliability state harus direview bersama dokumen arsitektur dan dicatat agar implementation tetap konsisten.
