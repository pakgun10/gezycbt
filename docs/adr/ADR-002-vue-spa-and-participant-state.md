# ADR-002 — Vue SPA dan state halaman peserta

**Status:** Accepted  
**Tanggal:** 16 September 2026  
**Issue:** ISS-005

## Context

Staff dan peserta membutuhkan route group yang berbeda. Halaman ujian peserta harus ringan, responsif, dapat resume setelah refresh, dan tetap aman ketika koneksi terputus. SSR atau state server-side per browser tidak diperlukan untuk single-tenant MVP.

## Decision

Gunakan Vue 3 + Vite sebagai SPA dengan lazy-loaded route group:

- `/admin/*`;
- `/teacher/*`;
- `/participant/*`;
- `/practice/*`.

Server hanya mengirim shell dan asset hashed; otorisasi tetap ditegakkan API pada setiap request. State authoritative exam session berada di server. Browser menyimpan manifest yang aman, draft jawaban, queue/outbox, dan UI state terbatas di IndexedDB. `localStorage` tidak menyimpan token auth, answer key, atau data sensitif.

Participant UI menggunakan state machine eksplisit: `READY`, `DIRTY`, `SAVING`, `OFFLINE_DIRTY`, `CONFLICT`, `FINALIZING`, `SUBMITTED`, `ENDED`. Navigasi soal tidak mengubah deadline server.

## Consequences

Bundle peserta dapat dipisahkan dari staff bundle. Refresh dapat melakukan resume/reconciliation. Offline support tidak berarti submit offline dianggap berhasil: server acknowledgement tetap diperlukan.

## Accessibility and theme

Touch target peserta minimum 44 px, focus management mengikuti `docs/03-ui-ux.md`, dan light/dark theme mengikuti system preference dengan user override.

## Re-evaluation

Tinjau bila kebutuhan SEO/public content, SSR, atau shared realtime state menjadi requirement yang terbukti.
