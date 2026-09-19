# ISS-162 — Failure dan recovery rehearsal

Tanggal: 19 September 2026  
Host staging: `43.156.50.50`  
Production: tidak disentuh

## Tujuan

Memverifikasi perilaku runtime ketika API restart saat ujian aktif dan ketika
deadline session terlewati. Rehearsal juga memastikan data yang sudah di-ack
tetap dapat dipakai untuk resume dan submit.

## Process restart dan resume

- Schedule sementara: `27`.
- Session: `6082`.
- Jawaban disimpan sebelum restart dengan version `1`.
- `gezycbt-staging.service` direstart melalui systemd.
- `/health/ready` kembali `200` dalam sekitar `1` detik.
- Request resume setelah restart mengembalikan manifest dan 1 jawaban
  authoritative.
- Submit setelah resume berhasil; session menjadi `SCORED` dengan reason
  `PARTICIPANT_SUBMIT`.

Kesimpulan: restart process tidak menghilangkan auth/session state di MariaDB,
manifest, atau jawaban yang telah committed.

## Timeout dan deadline

- Schedule sementara: `28`, duration `1` detik.
- Session: `6083`.
- Setelah deadline dilewati, request resume memfinalisasi session secara lazy.
- Status akhir: `SCORED`.
- `finalization_reason`: `DEADLINE`.
- Tidak ada jawaban yang tersimpan dan satu result dibuat.

## Reconciliation dan cleanup

- Schedule `27` dan `28`: `CLOSED`.
- Schedule `27`: 1 session, 1 answer, 1 result, active `0`.
- Schedule `28`: 1 session, 0 answer, 1 result, active `0`.
- Akun operator sementara `iss162-admin` dinonaktifkan.
- Health check setelah cleanup tetap lulus (`live=200`, `ready=200`, database
  `ok`).

## Restore response

Restore database/media tidak dijalankan pada host staging aktif karena prosedur
restore bersifat destruktif dan harus memakai host kosong atau target terisolasi.
Runbook resmi mewajibkan encrypted artifact, checksum, `GEZYCBT_CONFIRM_RESTORE=YES`,
migration forward-only, health check, three-role smoke, dan reconciliation
sebelum traffic dialihkan. Evidence restore drill terisolasi tetap menjadi gate
operasional sebelum pilot nyata.

## Status gate

`ISS-162` tetap `IN_REVIEW`: process restart, committed-data recovery, timeout,
dan cleanup sudah lulus; restore drill terisolasi serta simulasi jaringan
sekolah masih perlu dijalankan oleh operator pada maintenance window.

