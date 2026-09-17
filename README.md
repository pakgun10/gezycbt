# GezyCBT

Computer Based Test single-tenant untuk satu sekolah. Struktur workspace dan batas modul mengikuti [ADR-001](./docs/adr/ADR-001-modular-monolith-and-workspaces.md).

## Workspace

- `apps/api`: Elysia API (dibuat pada ISS-012)
- `apps/web`: Vue/Vite SPA (dibuat pada ISS-014)
- `packages/contracts`: kontrak lintas API/web
- `packages/config`: konfigurasi tervalidasi
- `packages/database`: adapter dan migration (dibuat pada ISS-015)
- `packages/testing`: fixture dan utilitas test

Prasyarat: Bun `1.4.2`. Jalankan `bun install`, lalu `bun run check`.
