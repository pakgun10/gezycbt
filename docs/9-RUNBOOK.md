# GezyCBT — Developer dan Operations Runbook

**Status:** Baseline operasional Fase 8 dan agent foundation/question authoring (ISS-100–ISS-110, ISS-120–ISS-125)
**Terakhir diperbarui:** 17 September 2026

Dokumen ini menjelaskan cara menjalankan fondasi repository, database lokal,
migrasi, API, dan bootstrap admin. Ia belum menggantikan runbook production
lengkap untuk systemd, Nginx, backup, restore, dan incident response; bagian
tersebut dikerjakan pada Fase 9.

## 1. Prasyarat

- Bun versi yang dipin di `package.json` (`1.4.2`).
- Docker Engine dan Docker Compose untuk MariaDB lokal/test.
- Port lokal yang tersedia: API `3000`, MariaDB development `33068`.

Dari root repository:

```bash
bun install
cp .env.example .env.local
```

Shell tidak memuat `.env.local` secara otomatis. Export variabelnya sebelum
menjalankan command, atau gunakan loader environment yang dipakai tim.

Untuk upload media agent, set `GEZYCBT_MEDIA_ROOT` ke direktori protected di luar
webroot. Jika tidak diisi, development memakai `.data/media` dan production
memakai `/var/lib/gezycbt/media`. Direktori ini tidak boleh dipetakan sebagai
static asset.

## 2. Database development

Nyalakan MariaDB disposable dengan volume persisten lokal:

```bash
bun run db:dev:up
```

Periksa status:

```bash
docker compose -p gezycbt-dev -f ops/docker-compose.dev.yml ps
```

Terapkan seluruh migration forward-only. Migration tidak dijalankan otomatis
saat API boot:

```bash
set -a
. ./.env.local
set +a
bun run db:migrate
```

Migration memakai advisory lock MariaDB dan checksum. Jika checksum migration
yang sudah diterapkan berubah, command gagal dan file migration harus dipulihkan
atau dibuat migration baru.

Hentikan database tanpa menghapus volume:

```bash
bun run db:dev:down
```

Untuk menghapus seluruh data development, gunakan perintah destructive berikut
secara sengaja:

```bash
docker compose -p gezycbt-dev -f ops/docker-compose.dev.yml down --volumes
```

## 3. Menjalankan API

Load konfigurasi lokal lalu jalankan API dalam mode watch:

```bash
set -a
. ./.env.local
set +a
bun run dev:api
```

Untuk proses tanpa watch:

```bash
bun run start:api
```

Endpoint pemeriksaan:

```bash
curl -i http://127.0.0.1:3000/health/live
curl -i http://127.0.0.1:3000/health/ready
```

`/health/live` hanya memeriksa proses. `/health/ready` memeriksa koneksi
MariaDB bila `GEZYCBT_DATABASE_URL` tersedia. API tidak menjalankan migration
sendiri agar beberapa process tidak berlomba melakukan DDL.

Hentikan API foreground dengan **Ctrl+C**. Process juga menangani `SIGTERM`
untuk graceful shutdown.

## 4. Menjalankan web development server

Pada terminal kedua:

```bash
bun run dev:web -- --host 127.0.0.1 --port 5173
```

Web shell tersedia di `http://127.0.0.1:5173`. Route staff tersedia setelah
login di `/admin/*` dan `/teacher/*`. Workflow authoring, jadwal, monitoring,
hasil, export, dan audit memakai API yang sama dengan service domain; jalankan
migration terbaru sebelum membuka halaman tersebut.

## 5. Bootstrap akun admin pertama

Migration harus sudah berhasil sebelum bootstrap. Password dibaca dari stdin;
jangan menaruh password di argument command atau file repository.

```bash
set -a
. ./.env.local
set +a
read -rsp 'Password admin: ' ADMIN_PASSWORD
printf '\n'
printf '%s' "$ADMIN_PASSWORD" | bun run bootstrap:admin \
  --username admin \
  --display-name 'Administrator' \
  --password-stdin
unset ADMIN_PASSWORD
```

Kebijakan password admin/staff adalah 12–128 karakter dan harus berbeda dari
username. Bootstrap hanya boleh berhasil sekali. Akun admin pertama diberi
`forcePasswordChange`; perubahan password dilakukan melalui workflow staff
setelah route manajemen password tersedia.

Pembuatan akun guru dan peserta tersedia melalui form serta import preview.
Commit import meminta re-authentication admin dan menghasilkan artifact
credential sekali pakai yang berumur pendek.

## 6. Quality gate sebelum mengambil issue Fase 8

```bash
bun run check
bun run db:test:up
bun run test:integration
bun run db:test:down
```

`bun run check` menjalankan typecheck, lint, unit test, dan build seluruh
workspace. Integration test memakai MariaDB disposable terpisah pada port
`33067`.

## 7. Diagnosis singkat

| Gejala | Pemeriksaan |
|---|---|
| Config gagal saat boot | Pastikan `APP_ENV`, `APP_RELEASE`, `APP_ORIGIN`, `HOST`, `PORT` terisi; staging/production wajib punya `GEZYCBT_DATABASE_URL`. |
| Readiness `503` | Periksa container MariaDB, URL, port `33068`, dan log API. |
| Migration lock gagal | Pastikan tidak ada command migration lain; tunggu lock timeout lalu ulangi. |
| Bootstrap ditolak | Admin sudah ada atau migration `system_locks` belum diterapkan. |
| Port dipakai | Ganti `PORT` API atau port host Compose hanya pada environment lokal. |

Log aplikasi tidak boleh memuat password, cookie, token, answer key, raw answer,
atau PII yang tidak diperlukan.

## 8. Batas entry gate

Entry gate ini dianggap lulus bila clean checkout dapat:

1. install dependency dengan lockfile;
2. menyalakan MariaDB development;
3. menjalankan migration satu kali dan ulang tanpa perubahan;
4. menjalankan API dengan readiness database;
5. menjalankan web shell;
6. menjalankan bootstrap admin satu kali;
7. menjalankan quality gate repository.

Setelah discovery foundation dan question/media authoring agent lulus, pekerjaan
berikutnya adalah `ISS-126` untuk exam authoring. Client agent dikelola dari
`/admin/integrations`; credential plaintext hanya muncul sekali setelah
re-authentication. Operasi export memakai job durable dan download token satu
kali yang berlaku maksimal lima menit.
