# GezyCBT

Computer Based Test single-tenant untuk satu sekolah. Struktur workspace dan batas modul mengikuti [ADR-001](./docs/adr/ADR-001-modular-monolith-and-workspaces.md).

## Workspace

- `apps/api`: Elysia API (dibuat pada ISS-012)
- `apps/web`: Vue/Vite SPA (dibuat pada ISS-014)
- `packages/contracts`: kontrak lintas API/web
- `packages/config`: konfigurasi tervalidasi
- `packages/database`: adapter dan migration (dibuat pada ISS-015)
- `packages/testing`: fixture dan utilitas test

Prasyarat: Bun `1.4.2` dan Docker Compose untuk MariaDB lokal/test.

Jalankan `bun install`, lalu `bun run check`.

## Quick start lokal

Salin `.env.example` menjadi `.env.local`, lalu ikuti
[`docs/09-RUNBOOK.md`](./docs/09-RUNBOOK.md) untuk menyalakan MariaDB, menjalankan
migration, API, web shell, dan bootstrap admin pertama.

Command utama:

```bash
bun run db:dev:up
bun run db:migrate
bun run dev:api
```

Hentikan API dengan `Ctrl+C`. Hentikan MariaDB dengan
`bun run db:dev:down`.

`bun run check` hanya menjalankan quality gate; migration tidak dijalankan
otomatis oleh API.
