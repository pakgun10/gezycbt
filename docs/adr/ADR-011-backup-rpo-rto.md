# ADR-011 — Backup, RPO, dan RTO untuk single VPS

**Status:** Accepted  
**Tanggal:** 16 September 2026  
**Issue:** ISS-005

## Context

Single VPS adalah single point of failure. Ujian dan hasil harus dapat dipulihkan tanpa mengandalkan disk lokal yang sama. Produk baseline membutuhkan pemulihan teruji, bukan hanya file backup yang belum pernah direstore.

## Decision

Baseline operasional:

- full backup database harian, retensi 7 hari;
- backup mingguan, retensi 4 minggu;
- media dan konfigurasi yang diperlukan ikut dibackup;
- salinan terenkripsi disimpan offsite;
- RPO maksimum 24 jam di luar ujian;
- target RTO maksimum 4 jam untuk restore ke host siap pakai;
- backup dianggap valid hanya setelah checksum/readability dan restore drill terjadwal lulus.

Saat ujian aktif, backup berat/export ditunda atau dibatasi agar tidak mengganggu exam runtime. Restore tidak menimpa production secara langsung; lakukan restore ke host/database terpisah lalu cutover terkontrol.

## Consequences

Biaya storage dan prosedur operasional bertambah. Kehilangan data antara backup terakhir dan insiden masih mungkin sampai batas RPO; acknowledged answers yang membutuhkan durability lebih ketat memerlukan binlog/replication sebagai keputusan lanjutan.

## Re-evaluation

Tinjau bila RPO/RTO disetujui lebih ketat atau jumlah data melampaui kapasitas backup window.
