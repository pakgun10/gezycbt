# ISS-160 — Staging production-like dry run

Tanggal: 19 September 2026  
Host: VPS staging `43.156.50.50`  
Environment: `gezycbt-staging`  
Production: tidak disentuh

## Tujuan

Memverifikasi workflow operasional lengkap pada staging setelah ISS-152 sampai
ISS-154: staff login, lifecycle jadwal, akses peserta, runtime ujian, resume,
submit, result release, dan ujian latihan.

## Hasil

| Check | Hasil |
|---|---|
| `/health/live` | PASS — HTTP 200 |
| `/health/ready` | PASS — HTTP 200, database `ok` |
| Staff authentication | PASS — akun operator staging sementara |
| MAIN schedule lifecycle | PASS — `DRAFT → READY → OPEN → CLOSED` |
| MAIN participant access | PASS — kode tambahan, eligibility, session dibuat |
| MAIN answer save | PASS — jawaban tersimpan dengan version 1 |
| MAIN refresh/resume | PASS — manifest dan jawaban authoritative tetap tersedia |
| MAIN submit | PASS — session `SCORED`, reason `PARTICIPANT_SUBMIT` |
| MAIN result release | PASS — release 1 result, peserta dapat membaca hasil |
| PRACTICE token resolve | PASS — token di-resolve tanpa login staff |
| PRACTICE identity snapshot | PASS — nama dan kelas tersimpan di session |
| PRACTICE save/resume/submit | PASS — session `SCORED`, immediate result |
| Cleanup | PASS — jadwal sementara ditutup, akun operator dinonaktifkan |

## Evidence runtime

- MAIN schedule: `24`; session: `6050`; participant: user `3`.
- PRACTICE schedule: `25`; session: `6051`; guest session tanpa `participant_id`.
- MAIN access-code hint: `•••-WH` (plaintext tidak disimpan dalam report).
- PRACTICE token hint: `•••-9U` (plaintext tidak disimpan dalam report).
- MAIN result: `1/1`, `100.00%`, released setelah operasi release staff.
- PRACTICE result: `1/1`, `100.00%`, released segera sesuai policy latihan,
  `canRetry=true`.
- Database verification setelah test:
  - schedules `23`, `24`, `25`: `CLOSED`;
  - sessions `6049`, `6050`, `6051`: `SCORED`;
  - active session: `0`;
  - schedule 24: 1 answer dan 1 result;
  - schedule 25: 1 answer dan 1 result.

## Isolation dan cleanup

- Test hanya menggunakan database dan service staging.
- Tidak ada production secret, production cookie, atau production data yang
  digunakan.
- Akun `iss160-admin` dibuat khusus untuk dry run lalu dinonaktifkan setelah
  evidence terkumpul.
- Jadwal sementara ditutup dengan alasan `ISS-160 staging dry run selesai`.

## Batas verifikasi

Dry run ini adalah API/runtime smoke test pada staging. Pemeriksaan perangkat
nyata, browser matrix, jaringan sekolah, prosedur support, dan pilot 30–100
peserta tetap menjadi scope `ISS-161` dan `ISS-162`.

