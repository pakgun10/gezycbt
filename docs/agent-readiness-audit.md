# Agent-readiness audit — ISS-120 sampai ISS-123

**Tanggal:** 17 September 2026
**Scope:** baseline machine integration untuk Hivekeep/Hermes pada deployment
single-tenant GezyCBT.

Dokumen ini mencatat hasil audit fondasi dan keputusan implementasi sebelum
tool CRUD/hasil/export agent dibuka pada issue berikutnya.

## ISS-120 — application-service readiness

- Actor context sudah membedakan `HUMAN`, `EXTERNAL_AGENT`, `SYSTEM`, dan
  `RECOVERY`; machine request tidak dapat mengisi role manusia dari body.
- Domain service users, academics, questions, exams, schedules, sessions, dan
  results tetap menjadi jalur aturan yang dipakai route web. Modul integration
  hanya mengautentikasi, mengecek capability/scope, dan meneruskan context.
- Idempotency port dan migration `integration_idempotency_keys` disiapkan untuk
  mutation agent. Read tidak membutuhkan idempotency key.
- Stable ID, optimistic version, dan error envelope yang sudah ada menjadi
  kontrak mutation agent; tidak ada akses repository atau SQL dari host agent.
- Capability yang belum diimplementasikan tidak otomatis tersedia pada client
  lama. Grant eksplisit dan `policy_version` menjadi batas review.

## ISS-121 — persistence

Migration `0018_integrations` membuat:

- `integration_clients` untuk client dan owner admin/guru;
- `integration_credentials` dengan token prefix dan digest SHA-256 saja;
- `integration_grants` dengan scope JSON, constraints, expiry, status, dan
  `grant_version`;
- `integration_idempotency_keys` dengan unique `(client, key)` dan expiry.

Credential aktif hanya lolos bila client dan owner masih aktif, credential belum
expired/revoked, dan owner tetap ber-role admin atau guru. Kill switch client
mencabut seluruh credential aktif dalam transaction yang sama. Grant berubah
secara optimistic melalui kenaikan `policy_version`.

## ISS-122 — machine authentication dan policy

- Endpoint agent memakai `Authorization: Bearer ...`; cookie staff dan CSRF
  tidak digunakan.
- Token plaintext acak 256-bit hanya dikembalikan pada response issue credential
  satu kali. Database menyimpan digest dan prefix untuk diagnosis aman.
- Rate limit awal per client adalah 60 read/menit dan 20 mutation/menit.
  Kegagalan autentikasi memakai bucket fingerprint 5/15 menit.
- Capability diperiksa ulang pada setiap request. Scope efektif adalah irisan
  grant dengan scope owner guru; grant `SCHOOL` ditolak untuk client milik guru.
- `GET /api/v1/integrations/agent/me` dan `/capabilities` tersedia sebagai
  smoke/discovery foundation. Search subjects, classes, question banks,
  questions, exams, dan schedules tersedia dengan cursor maksimal 20 item;
  hasil lebih dari satu kandidat ditandai `AMBIGUOUS_RESOURCE` dan tidak
  dipilih otomatis.
- Auth failure, capability denial, dan scope denial tercatat sebagai audit
  event; successful read umum tidak membuat row audit per request.

## ISS-123 — management UI dan kill switch

Console admin tersedia pada `/admin/integrations` dan menyediakan:

- pembuatan client dengan owner;
- detail client, credential prefix/status, dan grant;
- re-authentication sebelum membuat/mencabut credential atau grant;
- token plaintext dengan peringatan satu kali dan tombol salin;
- pencabutan credential/grant dengan alasan;
- kill switch yang menonaktifkan client serta mencabut credential aktif;
- aktivasi ulang client secara eksplisit tanpa menghidupkan kembali credential.

Semua perubahan memakai staff session, exact same-origin CSRF, idempotency key,
optimistic `updatedAt`/`policyVersion`, dan audit event. Management hanya
tersedia untuk admin; guru tidak dapat melihat atau mengubah integration client.

## Batasan yang sengaja ditunda

- Action plan prepare/confirm dan web approval: ISS-129.
- CRUD question/exam/schedule agent: ISS-125–ISS-126.
- Result/practice/export agent surface: ISS-127–ISS-128.
- Protected media/export serving dan worker durable: ISS-141–ISS-142.
- Full capability OpenAPI document dan typed Hivekeep/Hermes adapter: ISS-131.
