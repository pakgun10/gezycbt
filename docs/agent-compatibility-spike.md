# Agent compatibility spike — ISS-131

**Status:** kontrak lokal selesai; verifikasi host Hivekeep/Hermes dilakukan saat
adapter dipasang pada environment yang dipilih
**Tanggal:** 18 September 2026
**Berlaku untuk:** GezyCBT single-tenant, Agent Integration API v1
**Terkait:** [02-bot-automation.md](./02-bot-automation.md),
[6-COMPATIBILITY.md](./6-COMPATIBILITY.md), ISS-124, ISS-129, ISS-132

Dokumen ini adalah rencana dan bukti spike untuk memastikan adapter pada
Hivekeep atau Hermes dapat memakai API GezyCBT tanpa menambah channel bot,
database connection, atau security boundary baru. GezyCBT tidak mengklaim
Hivekeep/Hermes lulus pengujian runtime hanya karena kontrak lokal lulus;
versi dan konfigurasi platform external harus direkam ketika adapter benar-benar
dipasang.

## 1. Batas spike

Spike memeriksa enam sambungan yang dibutuhkan adapter:

1. **HTTP:** HTTPS REST/JSON, error envelope, timeout, retry, dan request ID.
2. **Tool:** discovery tool dan parameter schema dapat dipetakan ke endpoint
   canonical tanpa tool yang mempunyai akses SQL atau shell.
3. **MCP (opsional):** bridge hanya menerjemahkan tool call menjadi request
   HTTPS; domain tidak bergantung pada versi MCP.
4. **Vault:** token machine disimpan pada vault host agent dan tidak ditulis
   ke prompt, log, atau repository.
5. **Approval:** R2 memakai prepare/confirm; R3 dipantau setelah persetujuan
   web. Confirm hanya mengirim action ID dan `planHash`.
6. **File/polling:** export dipantau dengan polling/backoff dan diunduh dengan
   one-use token berumur paling lama lima menit.

Platform agent tetap boleh mati atau terputus. CBT web tidak menunggu agent dan
tidak kehilangan state domain ketika adapter offline.

## 2. Kontrak canonical yang diuji

Manifest executable berada di
`apps/api/src/modules/integrations/compatibility.ts` dan diuji oleh
`compatibility.test.ts`.

| Area | Kontrak |
|---|---|
| Transport | `HTTPS + JSON`, prefix `/api/v1/integrations/agent` |
| Auth | `Authorization: Bearer <token>`; cookie staff dan CSRF tidak dipakai |
| Trace | `X-Request-Id` disarankan; server mengembalikan request ID pada error |
| Version | `X-GezyCBT-Client-Version` opsional untuk diagnosis |
| Mutation | `Idempotency-Key` 16–128 karakter, wajib pada mutation |
| Download | `X-GezyCBT-Download-Token`, satu kali, TTL maksimum 300 detik |
| Action R2 | prepare → `AWAITING_CONFIRMATION` → confirm dengan `planHash` |
| Action R3 | prepare → `AWAITING_APPROVAL` → approve dari web → polling |
| Polling | exponential 1–15 detik dengan jitter ±3 detik; pause ketika offline |
| Boundary | tidak ada DB, raw SQL, shell, credential, atau audit mutation dari agent |

Daftar endpoint yang menjadi sumber kebenaran tetap berada pada section 11 di
`02-bot-automation.md`. Adapter tidak boleh membuat path alternatif atau
mengirim parameter domain baru pada confirm.

## 3. Matrix versi dan bukti

Versi aplikasi GezyCBT mengikuti matrix utama. Versi Hivekeep/Hermes sengaja
belum diisi sampai spike external dijalankan pada host yang tersedia.

| Komponen | Versi baseline | Bukti yang wajib dilampirkan | Status |
|---|---|---|---|
| Bun | `1.4.2` | `bun --version`, lockfile, test output | PASS lokal |
| Elysia | `1.4.30` | package lock, route contract test | PASS lokal |
| MariaDB | `11.4.x` exact patch | `SELECT VERSION()`, migration/integration log | PASS pada lane repository |
| Hivekeep | TBD saat adapter spike | commit/tag, manifest tool, vault config redacted, trace | PENDING external host |
| Hermes Agent | TBD saat adapter spike | commit/tag, MCP/custom tool config, approval trace | PENDING external host |
| MCP bridge (opsional) | TBD saat adapter spike | protocol/version, request translation trace | PENDING external host |
| Nginx/TLS | exact production patch | TLS endpoint, header, body-limit trace | PENDING staging |

`TBD` bukan wildcard yang boleh dipakai production. Sebelum adapter diaktifkan,
versi exact harus dicatat di tabel ini dan pada release evidence.

## 4. Skenario HTTP dan tool

### 4.1 Discovery

- Jalankan `GET /me` dan `GET /capabilities` saat startup serta setelah
  `CAPABILITY_DENIED` atau `ACTION_GRANT_CHANGED`.
- Pastikan response menunjukkan client/grant efektif tanpa secret plaintext.
- Daftarkan tool berdasarkan capability yang benar-benar dikembalikan. Tool
  high-risk yang tidak diberi grant tidak dipasang pada toolbox.

### 4.2 Read dan mutation

- Read memakai Bearer dan tidak membutuhkan `Idempotency-Key`.
- Mutation memakai key stabil saat retry; body sama harus replay, body berbeda
  dengan key sama harus `IDEMPOTENCY_CONFLICT`.
- Adapter menampilkan `requestId` dan safe error code, bukan stack trace atau
  SQL detail.
- Search ambigu tidak boleh auto-select; adapter meminta pemilik memilih stable
  ID.

### 4.3 Prepare/confirm dan web approval

- Prepare menyimpan exact plan, expected version, grant version, risk, impact,
  dan expiry.
- Perubahan target, grant, owner, atau plan hash membuat confirm ditolak.
- R3 tidak dapat dieksekusi hanya karena agent mengirim confirm; web admin harus
  approve dan agent mem-poll status.
- Action pending yang melewati 30 menit menjadi `EXPIRED` dan harus dipersiapkan
  ulang.

### 4.4 Export file

- Buat satu export, poll `QUEUED → RUNNING → READY/FAILED`, dan jangan poll
  lebih cepat dari backoff manifest.
- Ambil download token hanya setelah `READY`. Token kedua atau token yang sudah
  dipakai harus ditolak.
- Pastikan adapter tidak menaruh file/PII di chat publik tanpa allowlist pemilik.

## 5. Skenario vault dan offline

1. Simpan token pada secret store Hivekeep/Hermes; log startup hanya menyebut
   prefix client, tidak pernah token.
2. Matikan agent selama action berada pada state pending, nyalakan kembali, lalu
   ambil `GET /actions?status=AWAITING_CONFIRMATION` dan lanjutkan polling.
3. Matikan jaringan setelah prepare. Adapter mengembalikan status tertunda
   kepada pemilik, melakukan retry dengan jitter, dan tidak mengulang mutation
   tanpa idempotency key.
4. Cabut credential dari web admin. Request berikutnya harus gagal dan adapter
   menghapus token dari cache proses.

## 6. Exit criteria

### Kontrak lokal (dipenuhi ISS-131)

- [x] Manifest endpoint/header/auth/approval/download/polling tersedia.
- [x] Test memastikan cookie tidak diteruskan dan platform unknown ditolak.
- [x] Polling delay bounded serta deterministic ketika random source diuji.
- [x] Action route dan prepare/confirm test lulus pada API.
- [x] Tidak ada adapter yang membuka koneksi MariaDB atau memanggil domain
      secara langsung dari host agent.

### Spike external sebelum pilot

- [ ] Hivekeep atau Hermes dapat memanggil `/me`, `/capabilities`, satu read,
      satu idempotent mutation draft, dan menerima error envelope.
- [ ] Vault injection, token rotation/revoke, dan log redaction diverifikasi.
- [ ] R2 confirm dan R3 web approval/polling direkam dengan request ID.
- [ ] Export file dapat diunduh sekali dan token expired ditolak.
- [ ] Agent offline/reconnect tidak menghasilkan duplicate mutation.
- [ ] Tool yang tidak ada di capability tidak muncul atau selalu ditolak server.
- [ ] Trace, versi exact, konfigurasi, dan known limitation dilampirkan pada
      release evidence.

Jika salah satu item external gagal, GezyCBT tetap dapat dirilis tanpa adapter;
perbaikan dilakukan pada adapter/platform atau dicatat sebagai ADR. Kegagalan
adapter tidak boleh menurunkan SLO exam runtime.

## 7. Format evidence

Simpan laporan di luar repository atau pada release artifact yang tidak memuat
credential:

```text
date_utc:
platform: HIVEKEEP | HERMES
platform_version:
adapter_commit:
gezycbt_release:
mcp_version: n/a | ...
vault_provider:
scenario_results:
  discovery: pass|fail
  read: pass|fail
  idempotent_mutation: pass|fail
  r2_confirm: pass|fail
  r3_web_approval: pass|fail
  export_one_use_download: pass|fail
  revoke: pass|fail
  offline_reconnect: pass|fail
known_limitations:
request_ids:
```
