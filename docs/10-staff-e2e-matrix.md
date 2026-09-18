# Staff E2E dan Accessibility Matrix

Matrix ini menjadi acceptance checklist ISS-110 untuk halaman admin dan guru.
Semua skenario dijalankan dengan database fixture yang memiliki satu admin,
satu guru dengan dua subject dan dua class scope, minimal 100 question
revision, satu exam revision, satu schedule, dan sample result/export/audit.

## Viewport dan tema

| Profile | Viewport | Tema |
|---|---:|---|
| Mobile | 360×800, 390×844 | light, dark, system |
| Tablet | 768×1024, 1024×768 | light, dark |
| Desktop | 1366×768, 1440×900 | light, dark, reduced motion |

## Skenario wajib

| ID | Perjalanan | Acceptance |
|---|---|---|
| S01 | Staff login valid | Admin/guru masuk, cookie tetap HttpOnly, current role tampil |
| S02 | Login gagal/rate limit | Pesan generik, retry hint, tidak ada username enumeration |
| S03 | Menu admin vs guru | Pengguna/Akademik/Audit hanya terlihat admin; deep link guru menjadi 403 |
| S04 | Mobile sidebar | Drawer dapat dibuka keyboard/touch, Escape/trigger menutup, focus kembali |
| S05 | Admin create user | Validasi inline, password tidak dipantulkan, duplicate menghasilkan conflict |
| S06 | Import 1.500 row | Preview pagination 50, filter classification, blocking error menonaktifkan commit |
| S07 | Academic master data | Tahun ajaran, kelas, subject create/list; active year hanya satu |
| S08 | Teacher scope URL | Subject/class tersimpan di URL; filter/selection reset saat scope berubah |
| S09 | Question authoring | Tiga renderer editor, key terpisah, media/alt state, readiness grouped |
| S10 | Question publish | Error memblokir publish; warning memberi impact confirmation |
| S11 | Exam picker | 100+ soal tetap paginated, duplicate disabled, reorder keyboard, selected tray |
| S12 | Exam readiness | Issue menuju field/soal, report lama invalid setelah draft berubah |
| S13 | Schedule create | MAIN/PRACTICE policy, target, local timezone, token plaintext sekali |
| S14 | Schedule lifecycle | Draft→ready→open→close; close meminta alasan dan impact |
| S15 | Monitoring 1.000 peserta | Aggregate query terpisah, pagination 50, polling 15s ±3s, stale indicator |
| S16 | Monitoring pause/hidden tab | Pause menghentikan timer; visibility hidden menghentikan polling dan resume segera |
| S17 | Session drawer | Progress/last activity tampil, raw answer/key tidak ada, URL back menutup drawer |
| S18 | Session operation | Extension/end/reset meminta reason, expected version, confirmation dan outcome |
| S19 | Result release | Subset/select-all-filter, partial outcome, unrelease warning dan status jelas |
| S20 | Export history | QUEUED/RUNNING/READY/FAILED/EXPIRED, toast + persistent indicator, recreate |
| S21 | Audit detail | Cursor/filter, safe JSON escaped, allowlist before/after, redaction marker |
| S22 | Error boundary | Widget failure memiliki request ID/reload; data ujian/outbox tidak disentuh |
| S23 | Keyboard/screen reader | Landmark, heading order, modal focus trap/return, error focus, no color-only state |
| S24 | Responsive/theme regression | Tidak horizontal scroll 360px; light/dark/system tidak mengubah data/focus |

## Evidence minimum

- Playwright trace/screenshot untuk S01, S03, S06, S08, S11, S15, S19, S20,
  dan S23 pada mobile serta desktop.
- Accessibility scan tanpa critical/serious finding dan keyboard-only pass.
- Network log membuktikan mutation membawa CSRF + Idempotency-Key, read tidak
  menyimpan token/password/PII sensitif di localStorage atau URL.
- Load fixture 1.000 session memverifikasi list tetap server-paginated dan
  polling tidak melebihi satu request per interval per tab.
