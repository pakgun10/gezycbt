# ADR-008 — Server-authoritative hard deadline dan timeout semantics

**Status:** Accepted  
**Tanggal:** 16 September 2026  
**Issue:** ISS-005

## Context

Timer browser dapat dimanipulasi, tab dapat tidur, dan koneksi dapat terputus. Nilai ujian harus konsisten ketika 1.000 peserta mendekati deadline pada waktu yang sama.

## Decision

`started_at` dan `deadline_at` ditentukan server dalam UTC. Client hanya menampilkan countdown berdasarkan server time offset. Setiap read/write/submit memeriksa deadline server-side.

Sebelum deadline, submit mengirim jawaban final dan melakukan sync terakhir. Setelah deadline, server mengunci session secara atomik, menilai jawaban terakhir yang committed, dan menetapkan `finalization_reason=DEADLINE`. Request yang datang setelah finalization tidak mengubah answer/result dan menerima error aman.

Timeout finalization idempotent dan dapat dijalankan oleh request peserta, scheduler/finalizer, atau recovery command; hanya satu pemenang finalization yang membuat result.

## Consequences

Tidak ada perpanjangan karena refresh atau re-login. Clock drift dipantau dengan NTP dan database UTC. Endpoint submit harus memiliki lock/index yang memadai untuk herd di deadline.

## Re-evaluation

Tinjau bila sekolah membutuhkan grace period resmi; grace period harus menjadi field schedule yang eksplisit dan diaudit.
