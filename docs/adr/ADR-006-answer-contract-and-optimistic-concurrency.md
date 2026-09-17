# ADR-006 — Answer JSON contract dan optimistic concurrency

**Status:** Accepted  
**Tanggal:** 16 September 2026  
**Issue:** ISS-005

## Context

Autosave peserta dapat datang berulang, terlambat, atau dari dua tab/device. Server harus mengetahui versi jawaban yang dilihat client dan mencegah overwrite diam-diam.

## Decision

Jawaban disimpan per `exam_session_question` pada row `answers` dengan contract typed berdasarkan tipe soal:

- `SINGLE_CHOICE`: satu option ID atau null;
- `MULTIPLE_RESPONSE`: set option ID yang dinormalisasi sorted-unique;
- `TRUE_FALSE`: mapping tiga statement ID ke boolean atau null.

Request mutation membawa `baseVersion`, `clientMutationId`, dan jawaban yang sudah dinormalisasi. Server melakukan conditional update (`WHERE version = baseVersion`) lalu menaikkan version secara atomik. Mismatch menghasilkan `409 ANSWER_CONFLICT` dengan authoritative answer/version; client tidak boleh menyatakan tersimpan sebelum acknowledgement.

Idempotency key/mutation ID disimpan dengan hasil singkat agar retry tidak menggandakan side effect. Payload peserta tidak pernah memuat answer key.

## Consequences

Conflict dapat dipulihkan tanpa last-write-wins tersembunyi. Setiap autosave membutuhkan satu write kecil; batch digunakan bila sesuai. Contract validator harus sama di frontend dan backend melalui shared schema.

## Re-evaluation

Tinjau bila telemetry menunjukkan conflict tinggi atau kebutuhan collaborative editing muncul.
