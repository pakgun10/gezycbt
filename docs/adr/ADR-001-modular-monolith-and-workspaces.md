# ADR-001 — Modular monolith dan workspace boundaries

**Status:** Accepted  
**Tanggal:** 16 September 2026  
**Issue:** ISS-005

## Context

GezyCBT adalah aplikasi single-tenant untuk satu sekolah, dengan target sampai 1.000 peserta pada satu jadwal. Operasi database, exam runtime, dan deployment harus sederhana di VPS sekitar 2 GiB RAM. Microservices akan menambah network hop, deployment unit, observability, dan failure mode tanpa kebutuhan yang terbukti.

## Decision

Gunakan **modular monolith** dalam satu repository/workspace Bun. Modul berjalan dalam satu proses aplikasi dan berbagi database transaction boundary, tetapi dependency antar modul dibatasi melalui application service dan port internal.

Workspace awal:

- `apps/api` — Elysia HTTP/API;
- `apps/web` — Vue/Vite SPA;
- `packages/contracts` — schema request/response, error code, ID dan time codec;
- `packages/config` — konfigurasi tervalidasi;
- `packages/database` — pool, adapter Bun.SQL, migration runner;
- `packages/testing` — fixture dan test utilities bersama.

Domain backend berada di `apps/api/src/modules/*`. Modul tidak mengimpor repository konkret modul lain secara langsung; komunikasi memakai service/port yang eksplisit.

## Consequences

Deployment, logging, backup, dan rollback tetap satu unit. Scale-out belum menjadi baseline. Jika beban atau availability kelak membutuhkan pemisahan, boundary module dan port menjadi seam migrasi; keputusan itu memerlukan ADR baru.

## Constraints

- Tidak ada akses SQL dari frontend.
- Tidak ada entity/database type yang bocor ke `packages/contracts`.
- Domain tidak bergantung pada Elysia atau Vue.
- Background job tetap bounded dan tidak menjadi service terpisah pada MVP.

## Re-evaluation

Tinjau ulang bila single process gagal memenuhi SLO setelah load/soak test, atau ada kebutuhan isolasi failure yang tidak dapat dicapai dengan bounded queue dan modular boundary.
