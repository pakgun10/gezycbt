# ADR-003 — Bun.SQL versus Official MariaDB Connector

**Status:** Accepted  
**Tanggal:** 16 September 2026  
**Pemilik keputusan:** GezyCBT maintainers  
**Issue:** `ISS-004`  
**Evidence:** [7-BUN-SQL-SPIKE.md](../7-BUN-SQL-SPIKE.md)  
**Matrix:** [6-COMPATIBILITY.md](../6-COMPATIBILITY.md)

## Context

GezyCBT memakai Bun + Elysia + TypeScript dengan MariaDB sebagai source of truth. Exam runtime membutuhkan transaction, row lock, optimistic version, precise numeric handling, retry/error mapping, dan reconnect yang dapat diprediksi. VPS target hanya sekitar 2 GiB RAM sehingga dependency dan pool harus tetap sederhana.

Ada dua kandidat connector:

1. Bun.SQL, API SQL native yang mengikuti runtime Bun.
2. Official MariaDB Connector/Node.js, package resmi MariaDB yang dipakai sebagai fallback.

Pemilihan tidak boleh hanya berdasarkan API yang terlihat nyaman. Ia harus didasarkan pada test terhadap MariaDB yang benar-benar menjadi target deployment.

## Decision

GezyCBT memilih **Bun.SQL pada Bun `1.4.2` sebagai default database adapter** untuk baseline development dan production target TCP.

Keputusan ini berlaku dengan aturan berikut:

- target utama adalah MariaDB `11.4.x` exact patch yang lulus spike;
- MariaDB `10.11.x` tetap menjadi compatibility lane yang telah lulus pada spike;
- repository mendefinisikan adapter interface sendiri; application service tidak mengimpor Bun.SQL secara langsung;
- seluruh query memakai parameter binding atau helper identifier yang tervalidasi;
- pool, timeout, lifetime, retry, dan shutdown dikonfigurasi melalui infrastructure adapter, bukan tersebar di module domain;
- `BIGINT` tidak pernah diperlakukan sebagai JavaScript `number` bila dapat melampaui safe integer; adapter memakai representasi BigInt/string yang kemudian dinormalisasi oleh ID codec aplikasi;
- `DECIMAL` diperlakukan sebagai string/decimal value object agar scoring dan percentage tidak mengalami floating-point loss;
- export menggunakan pagination/chunking dan bounded memory karena Bun.SQL pada release yang diuji tidak menyediakan streaming/cursor API MySQL/MariaDB yang dapat dijadikan baseline;
- official `mariadb` Connector/Node.js tetap menjadi fallback adapter yang belum diaktifkan pada baseline.

## Evidence

Harness `spikes/bun-sql` lulus terhadap:

- MariaDB `11.4.13-MariaDB-ubu2404` melalui adapter `mariadb`;
- MariaDB `10.11.19-MariaDB-ubu2204` melalui adapter `mariadb`;
- parameter binding dan injection marker;
- `BIGINT`, `DECIMAL`, `JSON`, `BOOLEAN`, Unicode, dan `DATETIME(6)`;
- transaction commit/rollback dan connection pinning;
- `SELECT ... FOR UPDATE` dengan dua connection;
- unique/check/foreign-key error code;
- deadlock `1213` dan lock wait timeout `1205`;
- batch insert 100 row serta affected-row count;
- pool reservation cancellation, query cancellation, dan connection timeout;
- MariaDB restart dan same-client recovery pada lane utama;
- concurrent query/RSS smoke probe.

Tidak ada correctness failure pada lane yang diuji. Unix socket tidak menjadi target baseline karena deployment awal menggunakan TCP; bila target deployment berubah ke socket, harness wajib dijalankan ulang.

## Options considered

### Bun.SQL — dipilih

Kelebihan:

- tersedia langsung pada runtime Bun;
- tidak menambah driver runtime terpisah;
- API tagged query, pooling, prepared statement, transaction, `BIGINT`, timeout, dan close sesuai kebutuhan spike;
- hasil test pada dua versi MariaDB memenuhi kebutuhan correctness baseline.

Konsekuensi:

- behavior database mengikuti versi Bun sehingga upgrade Bun memerlukan compatibility rerun;
- API streaming/cursor MySQL/MariaDB tidak tersedia pada release yang diuji;
- error/type behavior harus dilindungi oleh adapter contract dan integration test sendiri.

### Official MariaDB Connector/Node.js — fallback

Kelebihan:

- driver resmi yang fokus pada MariaDB/MySQL;
- dapat menjadi jalur pemulihan bila Bun.SQL mengalami regression atau gap material;
- ecosystem API dan dokumentasi connector lebih khusus untuk MariaDB.

Konsekuensi:

- menambah dependency dan compatibility surface;
- rilis modern package mempunyai persyaratan Node.js, sehingga pemakaian dari runtime Bun wajib diuji kembali;
- memilihnya sebagai default tanpa evidence Bun.SQL tidak memberi manfaat yang cukup untuk baseline VPS kecil.

## Adapter boundary

Production code hanya bergantung pada port internal yang menyediakan operasi minimum berikut:

- `query`/`execute` dengan parameter binding;
- `transaction` yang menjamin connection pinning;
- `reserve` atau primitive setara untuk lock/concurrency test;
- `close` dan graceful shutdown;
- normalized database error (`unique`, `foreign_key`, `check`, `deadlock`, `lock_timeout`, `connection`, `timeout`);
- affected-row count dan generated ID;
- typed conversion untuk BigInt, Decimal, JSON, Boolean, dan UTC datetime.

Implementasi Bun.SQL berada di infrastructure layer. Repository/domain service tidak boleh memanggil `Bun.SQL` atau official connector secara langsung. Adapter contract test dijalankan terhadap setiap adapter yang diaktifkan.

## Consequences

### Positif

- fondasi database tetap ringan dan sesuai stack Bun;
- transaction dan locking behavior telah dibuktikan terhadap MariaDB nyata;
- fallback tetap mungkin tanpa mengubah application service;
- tidak ada ORM atau query abstraction besar yang menyembunyikan query hot path.

### Negatif dan mitigasi

| Konsekuensi | Mitigasi |
|---|---|
| Upgrade Bun dapat mengubah SQL behavior | Pin exact Bun, lockfile, compatibility gate, dan ADR review |
| Tidak ada streaming/cursor baseline | Export paginated/chunked, concurrency 1, memory budget, test file besar |
| Error mapping bergantung adapter | Normalized error contract dan integration tests pada MariaDB |
| Official connector belum terbukti pada Bun | Jalankan fallback smoke spike sebelum mengaktifkannya |
| BigInt/Decimal tidak aman bila dipaksa number | ID codec dan decimal value object; negative precision tests |

## Re-evaluation triggers

ADR ini harus ditinjau ulang bila terjadi salah satu kondisi:

1. upgrade Bun major/minor atau perubahan Bun.SQL yang menyentuh MySQL/MariaDB;
2. upgrade MariaDB major atau perubahan target server/provider;
3. regression pada transaction, row lock, type round-trip, error code, reconnect, atau affected-row semantics;
4. kebutuhan export streaming yang tidak dapat dicapai dengan pagination/chunking;
5. Bun.SQL tidak dapat memenuhi SLO atau memory budget setelah load/soak test;
6. official connector terbukti lebih stabil dan tidak melanggar target runtime/operasional.

## Follow-up

- `ISS-010` memakai adapter interface dan konfigurasi Bun.SQL yang diputuskan di sini.
- `ISS-015` migration runner dan `ISS-073` concurrency suite wajib memakai MariaDB asli.
- `ISS-107`/`ISS-128` tidak boleh mengandalkan seluruh dataset berada di memory.
- Fallback adapter tidak dibuat sebagai fitur production sebelum ada trigger atau test yang membutuhkannya.
