# ADR-012 — Keputusan produk P-01 sampai P-12

**Status:** Accepted  
**Tanggal persetujuan:** 16 September 2026  
**Issue:** ISS-005

## Context

Keputusan produk yang sudah disetujui tersebar di PRD, architecture, dan UI/UX. Implementasi membutuhkan satu baseline normatif agar perubahan tidak terjadi diam-diam.

## Decision

P-01 sampai P-12 menjadi baseline implementasi GezyCBT:

| ID | Keputusan normatif |
|---|---|
| P-01 | Soal choice memiliki minimal 2 dan maksimal 10 opsi. |
| P-02 | Ujian utama memberi tepat 1 attempt per peserta per schedule; reset memakai grant atomik. |
| P-03 | Ujian latihan dapat diulang; setiap start membuat session baru. |
| P-04 | Akhir jadwal adalah hard stop; deadline peserta tidak boleh melewati `ends_at`. |
| P-05 | Hasil ujian utama tidak langsung terlihat; guru/admin merilis hasil. |
| P-06 | Hasil latihan langsung terlihat tanpa answer key. |
| P-07 | Identitas latihan: nama wajib; instansi dan kelas opsional/configurable. |
| P-08 | Urutan soal dan opsi choice dapat diacak; tiga pernyataan `TRUE_FALSE` tidak diacak. |
| P-09 | Bobot per soal adalah angka desimal positif dengan default 1. |
| P-10 | Ujian utama dapat di-resume dari perangkat lain setelah login ulang. |
| P-11 | Zona waktu UI adalah `Asia/Jakarta`; database selalu UTC. |
| P-12 | Retensi audit minimal 1 tahun. |

Detail requirement dan acceptance scenario berada di [`../4-PRD.md`](../4-PRD.md), sedangkan behavior UI berada di [`../03-ui-ux.md`](../03-ui-ux.md).

## Change control

Perubahan terhadap P-01 sampai P-12 wajib memperbarui PRD, architecture, UI/UX yang terdampak, schema/API migration plan, dan acceptance tests. Keputusan tidak berubah hanya karena implementasi lebih mudah.

## Consequences

Tim memiliki baseline yang dapat ditelusuri. Perubahan produk yang sah tetap mungkin, tetapi harus eksplisit dan tidak mematahkan data/result lama tanpa migration atau compatibility plan.
