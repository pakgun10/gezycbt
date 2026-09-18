# Compatibility Matrix — GezyCBT

**Status:** Baseline matrix diterima; connector default ditetapkan oleh [ADR-003](./adr/ADR-003-bun-sql-vs-mariadb-connector.md)  
**Versi dokumen:** 0.1  
**Terakhir diperbarui:** 16 September 2026  
**Berlaku untuk:** Fase 0 compatibility spike dan Fase 1 repository foundation  
**Dokumen terkait:** [04-PRD.md](./04-PRD.md), [01-architecture.md](./01-architecture.md), [05-ISSUES.md](./05-ISSUES.md)

Dokumen ini menetapkan kombinasi versi dan lingkungan yang diuji secara reproducible. Hasil spike dan keputusan connector berada pada [07-BUN-SQL-SPIKE.md](./07-BUN-SQL-SPIKE.md) dan [ADR-003](./adr/ADR-003-bun-sql-vs-mariadb-connector.md).

## 1. Prinsip pinning

- Versi runtime, framework, compiler, database, dan tool test dipin ke versi exact pada repository serta lockfile.
- Dependency production tidak menggunakan tag `latest`, range caret, beta, canary, rolling, atau nightly.
- Patch update hanya diterima setelah CI, migration, integration test, dan compatibility smoke test lulus.
- Major update memerlukan compatibility review dan ADR bila mengubah behavior, type contract, SQL, atau deployment.
- Semua hasil spike mencatat versi binary, package, server, OS, arsitektur CPU, konfigurasi, dan tanggal pengujian.
- Kandidat pada dokumen ini berlaku pada 16 September 2026; sebelum instalasi ulang, versi upstream diverifikasi kembali lalu perubahan dicatat sebagai update dokumen.

## 2. Kandidat utama

| Komponen | Kandidat exact/target | Peran | Status |
|---|---|---|---|
| OS production/staging | Ubuntu Server 24.04 LTS, `x86_64` | Host baseline | Kandidat utama |
| CPU/RAM/disk | Minimal 2 vCPU, 2 GiB RAM, SSD/NVMe | Target single VPS | Baseline kapasitas |
| Runtime | Bun `1.4.2` stable | Runtime, package manager, test runner | Kandidat utama |
| HTTP framework | Elysia `1.4.30` | Backend API | Kandidat utama; hindari Elysia 2 beta |
| Language compiler | TypeScript `5.9.3` | Typecheck dan editor | Kandidat konservatif |
| Frontend framework | Vue `3.5.42` | Vue SPA | Kandidat utama |
| Frontend router | Vue Router `5.3.1` | Lazy-loaded SPA route groups | Kandidat utama |
| Frontend build | Vite `8.3.0` | Development/build static asset | Kandidat utama |
| Vue Vite plugin | `@vitejs/plugin-vue` `6.0.9` | Vue SFC transform | Kandidat utama |
| Vue typecheck | `vue-tsc` `3.3.11` | Typecheck `.vue` | Kandidat utama |
| Database server | MariaDB `11.4.x`, exact patch dipin saat spike | InnoDB source of truth | Kandidat utama |
| DB charset/collation | `utf8mb4`, collation dipilih eksplisit pada migration | Unicode dan sorting | Wajib diuji |
| Reverse proxy | Nginx `1.30.x` stable, exact patch dicatat saat provisioning | TLS, static asset, proxy, limits | Kandidat deployment |
| Browser E2E | Playwright `1.63.0` | Chromium, WebKit, Firefox automation | Kandidat test |

### 2.1 Alasan kandidat utama

1. Bun dipin ke stable release, bukan canary, agar runtime yang menjalankan API dan migration dapat direproduksi.
2. Elysia dipin ke latest stable 1.x pada saat baseline; rilis 2 beta tidak dipakai sebelum compatibility review tersendiri.
3. TypeScript 5.9.3 dipilih sebagai baseline konservatif untuk mengurangi risiko perubahan compiler API pada Vue tooling. TypeScript 7.0.2 boleh diuji pada lane terpisah, tetapi tidak otomatis menggantikan baseline.
4. MariaDB 11.4 menjadi target utama karena merupakan jalur stable jangka panjang yang lebih konservatif daripada rolling release. MariaDB 10.11 menjadi compatibility lane sekunder bila provider VPS sekolah menggunakannya.
5. Backend tetap dijalankan oleh Bun. Node.js hanya muncul pada fallback test bila official connector memerlukannya; mengganti runtime production memerlukan ADR baru.

## 3. Database compatibility lanes

| Lane | Server | Client | Tujuan | Keputusan |
|---|---|---|---|---|
| DB-A | MariaDB `11.4.x` exact patch | Bun.SQL dari Bun `1.4.2` | Jalur production yang diutamakan | Wajib lulus `ISS-003` |
| DB-B | MariaDB `10.11.x` exact patch | Bun.SQL dari Bun `1.4.2` | Menemukan perbedaan versi LTS dan portability gap | Disarankan lulus |
| DB-C | MariaDB `11.4.x` exact patch | `mariadb` `3.5.4` melalui adapter repository | Fallback jika Bun.SQL gagal pada correctness | Wajib disiapkan sebagai pembanding |
| DB-D | MariaDB `10.11.x` exact patch | `mariadb` `3.5.4` | Fallback portability sekunder | Hanya bila DB-B diperlukan |

Semua lane database memakai InnoDB, timezone server UTC, connection user non-root, TLS/socket behavior yang sama dengan target deployment, dan schema test yang identik. SQLite tidak boleh dipakai untuk menggantikan MariaDB pada unit integration test.

### 3.1 Aturan connector

- Repository mendefinisikan interface database sendiri sehingga adapter dapat diganti tanpa mengubah application service.
- `Bun.SQL` tetap menjadi kandidat pertama karena tersedia sebagai API SQL native Bun dan menyediakan pooling, transaction, prepared statement, timeout, serta dukungan MySQL/MariaDB yang harus dibuktikan terhadap server nyata.
- Official connector fallback yang diuji adalah `mariadb` `3.5.4`. Package tersebut mempunyai persyaratan Node.js pada rilis modernnya; compatibility spike wajib menguji apakah ia dapat dipakai dengan Bun yang menjadi runtime target.
- Jika Bun.SQL gagal pada satu perilaku correctness, misalnya transaction pinning, type conversion, affected-row semantics, deadlock mapping, atau reconnect, `ADR-003` memilih fallback atau mencatat gap yang dapat diterima beserta wrapper dan test-nya.

## 4. Toolchain dan environment matrix

| Environment | OS/CPU | Runtime | Database | Tujuan |
|---|---|---|---|---|
| Developer | Linux/macOS/Windows yang didukung Bun | Bun `1.4.2` | MariaDB `11.4.x` melalui disposable environment | Iterasi lokal |
| CI required | Ubuntu `24.04` `x86_64` | Bun `1.4.2` | MariaDB `11.4.x` | Gate setiap perubahan |
| CI compatibility | Ubuntu `24.04` `x86_64` | Bun `1.4.2` | MariaDB `10.11.x` | Portability lane |
| Fallback lane | Ubuntu `24.04` `x86_64` | Bun `1.4.2`; Node.js hanya bila adapter mengharuskan | MariaDB `11.4.x` | Membandingkan official connector |
| Staging | Sama dengan production | Exact release artifact | Exact MariaDB patch production | Dry run, restore, load, pilot |
| Production | Ubuntu Server `24.04` `x86_64` | Exact Bun release yang lulus spike | Exact MariaDB patch yang lulus spike | Deployment sekolah |

### 4.1 Browser support baseline

Browser patch tidak dipin sebagai dependency aplikasi. Setiap release candidate mencatat versi browser aktual pada laporan E2E.

| Keluarga | Baseline |
|---|---|
| Chrome desktop | Stable saat pilot dan satu major sebelumnya bila tersedia |
| Edge desktop | Stable saat pilot |
| Safari iOS/iPadOS | Versi yang dipakai perangkat sekolah dan satu major sebelumnya bila tersedia |
| Chrome Android | Stable saat pilot dan satu major sebelumnya bila tersedia |
| Firefox | Dipakai pada CI/E2E; dukungan operasional mengikuti hasil pilot |
| Browser lama/IE | Tidak didukung |

Flow wajib pada setiap keluarga yang dipakai sekolah: login, dashboard, start, tiga renderer soal, save, refresh/resume, offline/reconnect, submit, result, theme System/Terang/Gelap, keyboard, dan touch.

### 4.2 Browser capability yang harus diverifikasi

- IndexedDB untuk outbox;
- `BroadcastChannel` untuk warning multi-tab;
- service worker tidak diperlukan untuk correctness baseline;
- cookie Secure/HttpOnly/SameSite;
- `prefers-color-scheme` dan `prefers-reduced-motion`;
- upload multipart dan download file export;
- viewport 360 px, tablet, dan desktop tanpa horizontal scroll.

## 5. Dependency yang sengaja belum dikunci

| Komponen | Status | Alasan |
|---|---|---|
| Bun.SQL versus official MariaDB Connector | Bun.SQL dipilih; fallback tetap tersedia | Lihat ADR-003 dan trigger re-evaluation |
| TypeScript 7.x | Lane eksperimen | Tidak menjadi baseline sebelum `vue-tsc`, Elysia types, build, dan CI lulus |
| Hivekeep versus Hermes | Terbuka sampai `ISS-131` | Adapter external agent diuji setelah domain dan machine API stabil |
| k6 exact version | Dikunci pada `ISS-150` | Harus mengikuti environment load-test yang tersedia |
| Icon/editor/chart package | Tidak memblokir Fase 0 | Dipilih saat prototype sesuai UI/UX |

## 6. Reproducibility requirements

Sebelum `ISS-003` dimulai, environment spike harus dapat menghasilkan:

1. output `bun --version` dan `bun --revision`;
2. output versi semua package dari lockfile;
3. output `mariadb --version` serta `SELECT VERSION()`;
4. OS release, kernel, CPU architecture, dan memory limit;
5. konfigurasi charset, collation, timezone, SQL mode, dan connection limit;
6. checksum image/package atau artifact yang digunakan;
7. log test yang membedakan pass, fail, skipped, dan known limitation.

Tidak ada hasil spike yang diterima bila hanya dapat direproduksi pada mesin pribadi tanpa perintah setup dan konfigurasi yang tercatat.

## 7. Acceptance criteria `ISS-002`

- [x] Kandidat exact Bun, Elysia, Vue, Vite, TypeScript, MariaDB, dan OS tercatat.
- [x] Primary, fallback, compatibility lane, dan unsupported/prerelease boundary dibedakan.
- [x] Target production/staging dan CI memiliki OS, CPU architecture, runtime, dan database lane.
- [x] Browser/device baseline serta capability yang harus diverifikasi tercatat.
- [x] Version pinning, update policy, dan reproducibility requirements ditetapkan.
- [x] Connector default dan fallback ditetapkan melalui ADR-003 setelah evidence `ISS-003`.

**Status:** `ISS-002 DONE`.

## 8. Handoff ke `ISS-003`

Gunakan konfigurasi berikut sebagai default spike:

- Bun `1.4.2` stable;
- Bun.SQL dengan adapter MariaDB/MySQL yang tersedia pada release tersebut;
- MariaDB `11.4.x` exact patch sebagai DB-A;
- MariaDB `10.11.x` exact patch sebagai DB-B;
- official `mariadb` `3.5.4` sebagai DB-C fallback comparison;
- timezone DB UTC dan `utf8mb4`;
- dua connection nyata untuk race/locking tests;
- pool kecil yang mendekati target VPS, bukan pool unlimited.

Skenario, exit criteria, dan bukti pass/fail mengikuti bagian `ISS-003` pada [05-ISSUES.md](./05-ISSUES.md). Hasil spike wajib menghasilkan input langsung untuk [ADR-003](./01-architecture.md#k2-adr-minimum).

## Referensi upstream

Versi kandidat diverifikasi terhadap halaman upstream berikut pada 16 September 2026:

- [Bun releases](https://github.com/oven-sh/bun/releases) dan [Bun SQL documentation](https://bun.com/docs/runtime/sql)
- [Elysia npm releases](https://www.npmjs.com/package/elysia?activeTab=versions)
- [Vue npm releases](https://www.npmjs.com/package/vue?activeTab=versions)
- [Vite npm releases](https://www.npmjs.com/package/vite?activeTab=versions)
- [`@vitejs/plugin-vue` npm releases](https://www.npmjs.com/package/@vitejs/plugin-vue?activeTab=versions)
- [TypeScript npm releases](https://www.npmjs.com/package/typescript?activeTab=versions)
- [vue-tsc npm releases](https://www.npmjs.com/package/vue-tsc?activeTab=versions)
- [MariaDB server repository versions](https://mariadb.com/docs/server/server-management/install-and-upgrade-mariadb/installing-mariadb/binary-packages/mariadb-package-repository-setup-and-usage)
- [MariaDB Connector/Node.js](https://www.npmjs.com/package/mariadb)
- [Nginx stable releases](https://nginx.org/en/download.html)
- [Playwright npm releases](https://www.npmjs.com/package/playwright?activeTab=versions)

## Batas dokumen

Matrix ini menetapkan apa yang diuji, bukan jaminan bahwa seluruh kombinasi sudah lulus. `ISS-003` harus menjalankan test terhadap environment nyata dan boleh mengubah kandidat melalui evidence. Perubahan setelah spike dicatat di dokumen ini dan ADR-003 sebelum migration atau application service dikunci.
