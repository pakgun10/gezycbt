# ADR-005 — Immutable question dan exam revision

**Status:** Accepted  
**Tanggal:** 16 September 2026  
**Issue:** ISS-005

## Context

Peserta harus melihat dan dinilai terhadap konten yang sama meskipun guru mengedit bank soal setelah jadwal berjalan. Mengubah row aktif secara in-place akan membuat hasil lama sulit diaudit.

## Decision

Pisahkan identitas logis (`questions`, `exams`) dari revision immutable. Draft revision dapat diedit. Saat publish, sistem memvalidasi readiness lalu membuat revision immutable. `exam_schedules` menunjuk tepat satu published `exam_revision`; `exam_sessions` menyimpan referensi revision dan manifest soal yang dipakai.

Published revision tidak boleh diubah atau dihapus. Perubahan dilakukan dengan membuat draft revision baru. Foreign key memakai restrict/soft archive sesuai retention; data yang direferensikan session/result tidak di-hard-delete.

## Consequences

Audit, resume, scoring, dan reprint hasil deterministik. Storage bertambah karena revision, tetapi hanya metadata/content revision yang diperlukan dan dapat di-retain sesuai kebijakan.

## Re-evaluation

Tinjau bila storage atau authoring membutuhkan deduplicated content-addressed revision; invariant immutability tetap dipertahankan.
