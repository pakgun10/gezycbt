# Agent-readiness audit — ISS-120 sampai ISS-132

**Tanggal:** 18 September 2026
**Scope:** baseline machine integration untuk Hivekeep/Hermes pada deployment
single-tenant GezyCBT.

Dokumen ini mencatat hasil audit fondasi, tool stages, action approval, operasi
berisiko, dan contract/security suite untuk agent external. Verifikasi platform
Hivekeep/Hermes pada host nyata mengikuti
[agent-compatibility-spike.md](./agent-compatibility-spike.md).

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

## ISS-124 — discovery dan scope-safe search

- Search subject, class, question bank, question, exam, dan schedule memakai
  cursor bounded maksimal 20 item.
- Query dijalankan dengan effective owner/grant scope di SQL; hasil ambigu diberi
  marker `AMBIGUOUS_RESOURCE` dan tidak dipilih otomatis oleh adapter.
- Search/list question tidak pernah menyertakan answer key atau metadata storage.

## ISS-125 — question dan media authoring

- Agent dapat membaca question revision melalui `/questions/:id`; response aman
  menghilangkan `isCorrect`/`correctValue`.
- Answer key hanya dikembalikan bila request secara eksplisit meminta
  `includeKey=true` dan client memiliki capability terpisah
  `questions.read_key`. Akses ini menulis audit sensitif tanpa menyimpan isi key.
- Create draft, create/update revision, readiness validation, dan publish memakai
  `QuestionDraftService`, `QuestionPublishService`, dan
  `QuestionReadinessService` yang sama dengan route web. External agent context
  didelegasikan ke owner client, lalu teacher ownership/subject scope tetap
  diterapkan.
- Upload media agent menggunakan `MediaUploadService`: magic bytes, JPEG/PNG/WebP,
  maksimum 2 MiB dan 2.500 px, nama file aman, hash, random storage key, dan
  cleanup on failure. Asset hanya dikembalikan sebagai metadata aman; attachment
  ke draft memerlukan alt/decorative validation.
- Mutation membutuhkan `Idempotency-Key` bounded 16–128 karakter dan expected
  timestamp untuk update/publish. Durable action replay dan prepare/confirm tetap
  berada di ISS-129.

## ISS-126 — exam authoring

- Agent exam memakai `IntegrationExamAuthoringService` dan application service
  exam yang sama dengan route web: `ExamDraftService`,
  `ExamReadinessService`, dan `ExamPublishService`.
- Surface mencakup safe read exam/revision, create exam/revision, update
  metadata, attach/remove/reorder question revision, readiness report, dan
  publish. Response tidak membawa isi soal atau answer key.
- Owner/grant/subject/exam scope diperiksa sebelum setiap operasi. Client
  teacher dibatasi pada exam milik owner; client admin dapat memilih
  `ownerTeacherId` dalam scope yang diberikan.
- Mutation membuat external-agent actor context, wajib memakai bounded
  `Idempotency-Key`, dan mencatat audit event. Update/reorder/attach/remove/
  publish menggunakan `expectedUpdatedAt` untuk optimistic concurrency.
- Publish gagal dengan report readiness ketika ada error; published revision
  tetap immutable. Exact action plan dan web approval tersedia pada ISS-129.

## ISS-127 — result dan practice reads

- Agent result memakai `IntegrationResultReadService` dan tabel result/session
  authoritative. Summary schedule hanya mengembalikan aggregate dan counter,
  tanpa nama, username, identity snapshot, jawaban, atau answer key.
- Hasil MAIN memerlukan capability `results.read` dan mengembalikan stable
  `participantId` serta nama snapshot akun. Hasil PRACTICE memerlukan capability
  terpisah `results.read_practice` dan mengembalikan identity snapshot yang
  sudah diminimalkan (nama, kelas, instansi, extra string tervalidasi).
- List result memakai cursor dan filter `RELEASED`/`UNRELEASED` dengan batas
  halaman 1–100. Detail satu result memakai session ID dan sensitive-read audit;
  list yang memuat hasil juga diaudit satu kali per request, bukan per baris.
- Scope diperiksa pada owner teacher, subject, dan schedule ID sebelum result
  dikembalikan. Response tidak pernah memuat raw answer, password, token, atau
  `finalization_note`.
- Practice response memuat `canRetry` dan `canRetryReason`. Retry tersedia saat
  schedule OPEN; schedule CLOSED/ARCHIVED memakai `SCHEDULE_CLOSED`, sedangkan
  state lain yang belum dapat diakses memakai `TOKEN_INVALID_OR_EXPIRED`.

## ISS-128 — controlled export

- Agent export memakai `ExportService` dan bounded worker yang sama dengan
  route web. Job menyimpan integration client, grant version, scope snapshot,
  filter, kolom, format, dan row limit di MariaDB.
- Capability `results.export` wajib tersedia. Kolom tambahan
  (`participantId`, `username`, `class`, `institution`) memerlukan constraint
  `result_pii_export_allowed=true`; response status tidak memuat isi file.
- Satu job `QUEUED`/`RUNNING` aktif dibatasi per client. Pembuatan agent
  memakai `integration_idempotency_keys` dalam transaction yang sama dengan
  insert job sehingga retry dengan body sama replay aman dan body berbeda
  ditolak.
- Status dipoll melalui endpoint agent tanpa audit row per polling. Token
  download disimpan sebagai digest, berlaku maksimal 5 menit, terikat client,
  dan dikonsumsi atomik satu kali. Download berhasil diaudit.
- Job dan file melewati state `QUEUED` → `RUNNING` → `READY` atau `FAILED`,
  lalu `EXPIRED` setelah expiry; worker membatasi query dan concurrency satu.

## ISS-129 — exact action plan dan approval

- `IntegrationActionService` membuat exact plan immutable dengan capability,
  operation, stable target ID, expected versions, parameters, impact, risk,
  approval method, client/owner, dan grant version.
- `planHash` adalah SHA-256 canonical JSON yang stabil; confirm hanya menerima
  action ID dan hash, bukan parameter domain baru.
- Action pending berlaku 30 menit, dapat dipoll atau dibatalkan, dan menjadi
  `EXPIRED` secara idempotent setelah deadline.
- R2 memakai agent confirm. R3 memerlukan approval admin web dengan
  re-authentication; plan/grant/target diverifikasi ulang sebelum eksekusi.
- Migration `0020_agent_actions` menyimpan action dan approval dengan index
  status/expiry/client/target. Replay prepare dengan key sama aman.

## ISS-130 — high-risk operation callbacks

- Publish exam, release/unrelease result, tutup jadwal, extend time, akhiri
  session, reset attempt, dan disable user melewati application/domain service
  yang sama dengan web.
- `EXTERNAL_AGENT` hanya menjadi actor teknis terverifikasi; ia tidak dapat
  menetapkan finalization reason di luar enum domain. Reset attempt membuat satu
  grant yang dikonsumsi atomik oleh replacement session.
- Operasi release memakai row lock dan filter/ID snapshot dari plan; hasil action
  dikembalikan sebagai ringkasan aman.
- Admin web melihat pending action pada `/admin/integrations` dan menyetujui
  exact plan. `Tutup Jadwal` tetap berbeda dari `Akhiri Sesi` individual.

## ISS-131 — compatibility spike contract

- Manifest executable untuk REST/Bearer, mutation headers, prepare/confirm,
  approval polling, one-use download, dan backoff berada di
  `apps/api/src/modules/integrations/compatibility.ts`.
- Unit contract memastikan cookie tidak diteruskan, platform unknown ditolak,
  dan polling delay tetap bounded. Rencana bukti host dan matrix versi ada di
  [agent-compatibility-spike.md](./agent-compatibility-spike.md).
- Hivekeep/Hermes belum dianggap lulus external runtime sebelum adapter,
  vault, reconnect, dan approval diuji pada staging dengan versi exact.

## ISS-132 — contract, security, dan load isolation

- Test suite mencakup Bearer-only boundary, revoked capability + audit,
  secret/answer/finalization-note redaction, bucket rate-limit terpisah,
  canonical plan hash, action route, dan export contract.
- Burst 1.000 read agent diuji dengan bucket bounded tanpa memakai mutation
  bucket; jalur agent tetap terpisah dari exam runtime.
- Read polling biasa tidak membuat row audit per request; mutation, denial,
  approval, sensitive read, dan download tetap dapat ditelusuri.

## Batasan yang sengaja ditunda

- CRUD schedule agent: issue lanjutan setelah exam authoring.
- Protected media/export serving dan worker durable: ISS-141–ISS-142.
- Instalasi adapter production Hivekeep/Hermes dan evidence external: sebelum
  pilot, mengikuti exit criteria ISS-131.
