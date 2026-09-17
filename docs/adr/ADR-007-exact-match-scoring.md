# ADR-007 — Exact-match scoring untuk tiga tipe soal

**Status:** Accepted  
**Tanggal:** 16 September 2026  
**Issue:** ISS-005

## Context

MVP hanya memiliki `SINGLE_CHOICE`, `MULTIPLE_RESPONSE`, dan `TRUE_FALSE`. Sekolah menginginkan aturan sederhana dan dapat dijelaskan; partial credit meningkatkan ambiguitas dan risiko perbedaan interpretasi.

## Decision

Semua tipe memakai exact match, tanpa partial credit:

- `SINGLE_CHOICE`: jawaban option ID sama persis dengan key;
- `MULTIPLE_RESPONSE`: set pilihan sama persis, urutan diabaikan;
- `TRUE_FALSE`: ketiga statement harus terjawab dan seluruh boolean sama dengan key.

Jawaban kosong/tidak lengkap mendapat skor nol. Scorer adalah pure domain function yang menerima immutable question revision dan answer normalized. Key hanya dibaca server-side; participant API tidak mengembalikannya.

## Consequences

Scoring deterministik, mudah diuji table-driven, dan konsisten antara submit dan regrade. UI wajib menjelaskan rule exact match tanpa membocorkan key.

## Re-evaluation

Tipe baru atau partial credit memerlukan ADR serta versioned scoring policy; hasil lama tetap memakai policy yang tersimpan.
