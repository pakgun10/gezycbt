# ISS-161 — Synthetic pilot rehearsal

Tanggal: 19 September 2026  
Host staging: `43.156.50.50`  
Production: tidak disentuh

## Tujuan

Memastikan workflow dan observability siap sebelum pilot dengan peserta nyata.
Rehearsal memakai 30 akun peserta staging yang berbeda dan satu schedule MAIN
sementara. Traffic berasal dari laptop load-generator melalui HTTP concurrent;
hasil ini bukan pengganti uji perangkat dan jaringan nyata.

## Hasil

| Signal | Hasil |
|---|---:|
| Peserta yang dijalankan | 30 |
| Login berhasil | 30/30 |
| Start session berhasil | 30/30 |
| Autosave berhasil | 30/30 |
| Refresh/resume berhasil | 30/30 |
| Submit berhasil | 30/30 |
| Result tercatat | 30/30 |
| Session aktif setelah selesai | 0 |
| HTTP/runtime failure | 0 |
| Durasi seluruh rehearsal | 5,91 detik |

## Latency observasi

| Operasi | p50 | p95 | maksimum |
|---|---:|---:|---:|
| Login | 331,0 ms | 416,0 ms | 662,0 ms |
| Start | 88,4 ms | 306,5 ms | 584,8 ms |
| Autosave | 79,4 ms | 107,5 ms | 371,1 ms |
| Resume | 77,8 ms | 172,2 ms | 865,6 ms |
| Submit | 82,5 ms | 96,3 ms | 106,5 ms |

## Database reconciliation

- Schedule sementara: `26`, status akhir `CLOSED`.
- Session: 30, seluruhnya `SCORED`.
- Answer: 30.
- Result: 30.
- Active session: 0.
- Akun operator sementara dinonaktifkan setelah test.

## Cleanup

Schedule `26` ditutup dengan alasan `ISS-161 synthetic pilot rehearsal selesai`.
Akun operator `iss161-admin` dinonaktifkan. Plaintext kode akses tidak disimpan
di repository maupun report.

## Status gate

Rehearsal ini memenuhi gate teknis awal, tetapi `ISS-161` tetap `IN_REVIEW`
sampai operator menjalankan pilot nyata dengan kombinasi perangkat/browser dan
jaringan yang mewakili sekolah, mencatat issue support, serta menyetujui
reconciliation hasil. Failure/recovery test tetap menjadi scope `ISS-162`.

