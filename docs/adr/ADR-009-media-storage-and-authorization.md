# ADR-009 — Media storage terpisah dari database dan authorized delivery

**Status:** Accepted  
**Tanggal:** 16 September 2026  
**Issue:** ISS-005

## Context

Soal dapat memakai gambar. Menaruh binary besar di MariaDB memperbesar backup, memory, dan query cost. Namun URL media tidak boleh menjadi akses publik permanen.

## Decision

Simpan metadata media di MariaDB dan object/file content pada media storage terpisah (local volume terproteksi pada MVP, compatible dengan S3/MinIO). Upload divalidasi magic bytes, MIME allowlist JPEG/PNG/WebP, ukuran/dimensi, checksum, dan atomic move.

Media disajikan melalui endpoint aplikasi yang memeriksa actor dan referensi revision. URL bersifat short-lived/opaque; tidak menyimpan credential storage. Asset yang direferensikan published revision immutable dan tidak dihapus. Orphan cleanup hanya menghapus asset yang tidak direferensikan setelah retention.

Alt text dan decorative flag wajib untuk aksesibilitas; metadata sensitif tidak masuk log.

## Consequences

Backup harus mencakup database dan media. File serving menambah I/O, sehingga ukuran dan concurrency dibatasi. Migrasi storage memerlukan checksum verification.

## Re-evaluation

Tinjau bila media volume atau bandwidth melebihi kapasitas VPS; object storage eksternal dapat diaktifkan tanpa mengubah domain reference.
