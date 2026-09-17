# Participant E2E Matrix — GezyCBT

**Status:** baseline untuk ISS-092
**Tanggal:** 17 September 2026
**Scope:** flow peserta utama dan latihan dari login/start sampai hasil.

Dokumen ini menjadi matriks acceptance untuk browser automation. Test runner dapat
menggunakan Playwright atau harness browser setara; endpoint API boleh di-stub
pada unit UI, tetapi satu smoke lane harus memakai API dan MariaDB disposable.

## 1. Browser dan viewport

| Lane | Viewport | Fokus |
|---|---:|---|
| Mobile narrow | 360×800 | tidak ada horizontal scroll, tombol touch target 44 px, palette drawer |
| Mobile tall | 390×844 | keyboard/input dan bottom navigation tidak menutup konten |
| Tablet | 768×1024 | layout transisi tanpa overlap |
| Desktop | 1366×768 | palette side rail, toolbar, modal focus |

Setiap lane diulang pada `prefers-color-scheme: light` dan `dark`. Override theme
`system → light → dark → system` harus bertahan selama reload melalui local storage.

## 2. Matrix skenario

| ID | Skenario | Verifikasi utama |
|---|---|---|
| E2E-01 | Login peserta utama berhasil | Cookie tidak terlihat di JS, dashboard memuat hanya schedule eligible |
| E2E-02 | Login gagal/akun salah | Pesan generic, tidak membedakan username/role/status, retry tetap tersedia |
| E2E-03 | Dashboard kosong dan error | Empty state aman; error menampilkan request ID dan tombol retry |
| E2E-04 | Attempt aktif dan reset grant | Card menampilkan `Lanjutkan Ujian`; grant baru menampilkan badge `Attempt baru tersedia` dan tombol start |
| E2E-05 | Pre-exam start | Tombol disable selama request, stage 3 detik, status check 15 detik memakai start key yang sama |
| E2E-06 | Kode tambahan ujian utama | Input uppercase/strip hyphen, tepat 5 karakter, kode salah tidak membocorkan detail |
| E2E-07 | Practice token dan identitas | Token uppercase/strip hyphen; nama wajib 2–200; error inline; field snapshot tidak disimpan di storage |
| E2E-08 | Render SINGLE_CHOICE | Radio semantic, satu pilihan, stimulus/prompt/media aman tanpa answer key |
| E2E-09 | Render MULTIPLE_RESPONSE | Checkbox semantic, ≥1 pilihan, instruksi exact match terlihat |
| E2E-10 | Render TRUE_FALSE | Tiga pernyataan masing-masing Benar/Salah; incomplete tidak dikirim sebagai jawaban lengkap |
| E2E-11 | Autosave online | State `DIRTY → SAVING → READY`, batch maksimal 20, server version tersimpan |
| E2E-12 | Refresh saat online | Resume mengambil manifest/order/deadline dan jawaban authoritative |
| E2E-13 | Offline lalu reconnect | Banner assertive, outbox IndexedDB tetap ada, reconnect mengirim latest answer dan menghapus ack |
| E2E-14 | Conflict dua device/tab | State `CONFLICT`, peserta dapat memilih server atau jawaban lokal; local retry memakai baseVersion baru |
| E2E-15 | Auth expired saat ujian | Modal login ulang; timer dan outbox tidak dihapus; resume session yang sama setelah login |
| E2E-16 | Submit normal | Dialog merangkum answered/unanswered, submit idempotent, tidak bisa double click, redirect hasil |
| E2E-17 | Submit network/503/409 | Pesan sesuai failure matrix; retry tidak menggandakan result; conflict meminta reconciliation |
| E2E-18 | Deadline/timeout | Timer server authoritative, announcement threshold sekali per nilai, final state hasil dapat dibuka |
| E2E-19 | Session ended/staff close | Save berikutnya berhenti; label safe reason; `finalization_note` tidak tampil |
| E2E-20 | Result practice/main | Aggregate benar/salah/kosong, practice `canRetry` mapping, main release gate, answer key tidak bocor |
| E2E-21 | Focus dan keyboard | Navigasi soal fokus heading, modal mengembalikan focus ke trigger, error fokus field pertama, toast tidak mencuri focus |
| E2E-22 | Reduced motion | Pulse/transition non-esensial mati saat `prefers-reduced-motion: reduce`, status tetap terlihat |
| E2E-23 | Storage privacy | IndexedDB hanya snapshot/outbox; token mentah, password, cookie, answer key, dan finalization note tidak tersimpan |

## 3. Exit criteria ISS-092

- Semua skenario E2E-01 sampai E2E-23 lulus pada empat viewport.
- E2E-01, E2E-05, E2E-11, E2E-13, E2E-15, E2E-16, dan E2E-18 lulus pada API nyata + MariaDB disposable.
- Tidak ada console error yang berasal dari aplikasi, unhandled rejection, atau horizontal overflow pada viewport target.
- Accessibility smoke (keyboard traversal, accessible name, focus return, axe atau pemeriksaan setara) lulus pada light dan dark theme.
- Screenshot baseline untuk empat viewport disimpan sebagai artifact CI hanya untuk diagnosis; keputusan acceptance berasal dari assertion perilaku.
