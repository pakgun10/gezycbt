# ADR-013 — Aktivasi revision soal, quiz lock, dan Regrade

**Status:** Accepted  
**Tanggal:** 5 Oktober 2026  
**Issue:** ISS-187

## Context

Revision immutable sudah menjaga attempt lama. Namun jadwal saat ini menunjuk
revision soal secara langsung sehingga attempt baru pada jadwal yang sama tidak
dapat menerima perbaikan compatible. Editor juga memisahkan Simpan draft,
Validasi, dan Publish, sementara guru membutuhkan satu tindakan Simpan.

Perubahan struktur kuis yang terjadi setelah attempt pertama dapat membuat
manifest peserta tidak konsisten. Regrade harus dapat memperbaiki penilaian
secara eksplisit tanpa mengubah jawaban, manifest, atau histori nilai.

## Decision

1. Logical question mempunyai `current_published_revision_id`. Perpindahan
   pointer hanya terjadi ketika revision valid dipublish dalam use case yang
   sama dengan Simpan.
2. Draft tetap dipertahankan sebagai state internal untuk pekerjaan tidak
   lengkap, upload media, dan recovery. UI hanya menampilkan tindakan utama
   **Simpan**. Draft tidak valid tidak memindahkan pointer aktif.
3. Opsi dan pernyataan memiliki `stable_key` acak yang disalin ke revision
   baru. Kompatibilitas berarti tipe sama dan kumpulan stable key sama.
   Penambahan, penghapusan, atau perubahan tipe adalah struktural.
4. Slot exam mempertahankan baseline revision. Saat session dibuat, server
   memilih current published revision dari logical question hanya bila
   compatible dengan baseline. Exact revision terpilih dibekukan dalam
   `exam_session_questions`.
5. Jadwal memiliki `structure_locked_at` dan `structure_locked_by_session_id`.
   Start pertama menetapkannya bersama session dan manifest pada satu transaksi.
   Setelah lock, struktur hanya dapat diganti melalui exam revision atau jadwal
   baru.
6. Regrade hanya memproses session final dan target compatible. Ia membuat run
   serta item histori append-only, lalu memperbarui snapshot `exam_results`
   secara idempotent. Manifest dan jawaban tidak diubah.

## Consequences

Attempt lama deterministik, sementara perbaikan compatible dapat dipakai oleh
attempt baru. Schema dan test bertambah karena backfill stable key, pointer aktif,
serta histori Regrade. Perubahan struktural sengaja tidak dipromosikan pada
jadwal terkunci untuk mencegah perubahan pengalaman antar peserta tanpa
persetujuan guru.

## Re-evaluation

Tinjau kembali bila produk membutuhkan essay/manual grading atau kebijakan yang
mengizinkan structural replacement untuk jadwal yang belum dimulai.
