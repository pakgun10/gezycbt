Sekarang fokus terbaik adalah **uji alur CBT lengkap sebelum load test**.

Urutannya:

1. Login sebagai admin.
2. Buat data dasar:
   - tahun ajaran;
   - kelas;
   - mata pelajaran;
   - akun guru;
   - akun peserta.
3. Login sebagai guru:
   - buat bank soal;
   - buat soal;
   - buat dan publish ujian;
   - buat jadwal ujian.
4. Uji sebagai peserta:
   - login ujian utama;
   - masukkan kode tambahan jika diminta;
   - mulai ujian;
   - simpan jawaban;
   - refresh/resume;
   - submit.
5. Uji ujian latihan dengan token.
6. Setelah alur ini lulus, lanjut:
   - ISS-152: load test 1.000 peserta;
   - ISS-153: soak dan restart recovery;
   - ISS-154: capacity report;
   - ISS-160: pilot 30–100 peserta.

Jangan gunakan ujian nyata sebelum smoke test dan load test selesai.

Hasil pengujian 1000 peserta
ISS-153 dan ISS-154 sudah selesai.

### Hasil

- Soak 1.000 peserta selama 4 jam 10 menit.
- Total request: 1.194.817.
- Error: 84 request atau 0,0070% — di bawah batas 0,5%.
- Start p95: 94 ms.
- Resume p95: 178 ms.
- Autosave p95: 168 ms.
- Submit p95: 173 ms.
- Verifier: 1.000 session, result, dan answer; tanpa duplikasi; 0 session aktif.
- Restart API berhasil dan readiness kembali `200`.
- API RSS maksimum sekitar 102 MiB.
- MariaDB `Max_used_connections`: 16.

Laptop **sudah boleh dimatikan**. Schedule staging dan runner sudah dihentikan; production tidak disentuh.

Dokumentasi dan evidence:

- [ISS-153 evidence](</home/pgun/dev/gezy/gezycbt/reports/performance/staging-20260919-iss153-final/README.md>)
- [ISS-154 capacity report](</home/pgun/dev/gezy/gezycbt/reports/performance/staging-20260919-iss154-capacity-report.md>)
- [Performance validation](</home/pgun/dev/gezy/gezycbt/docs/14-performance-validation.md>)
- [Issue status](</home/pgun/dev/gezy/gezycbt/docs/05-ISSUES.md>)

Commit sudah dipush: `413a639`.

Langkah berikutnya adalah **ISS-160 — pilot 30–100 peserta**.
