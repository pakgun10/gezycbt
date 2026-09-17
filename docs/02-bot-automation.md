# Integrasi External AI Agent dengan GezyCBT

**Status:** Fondasi ISS-120–ISS-123 dan discovery ISS-124 diimplementasikan; tool workflow lanjutan masih bertahap
**Versi dokumen:** 0.3  
**Terakhir diperbarui:** 17 September 2026
**Platform yang dipertimbangkan:** Hivekeep atau Hermes Agent  
**Dokumen induk:** [01-architecture.md](./01-architecture.md)

Dokumen ini menggantikan asumsi bahwa GezyCBT membuat bot Telegram/WhatsApp sendiri. Bot, channel, percakapan, memory, LLM, dan agent loop dijalankan oleh Hivekeep atau Hermes sebagai aplikasi terpisah. GezyCBT menyediakan API/tool yang aman agar agent dapat menjalankan pekerjaan CBT.

Fondasi machine client, credential, grant, rate limit, audit, discovery endpoint,
management console, dan kill switch tersedia pada ISS-120–ISS-124.
Tool CRUD, action approval, hasil, dan export dibuka setelah issue lanjutan
selesai; daftar batasnya ada di [agent-readiness-audit.md](./agent-readiness-audit.md).

Kata **wajib** berarti aturan correctness atau security yang tidak boleh dilewati. Kata **disarankan** adalah baseline yang dapat diubah melalui Architecture Decision Record.

---

## 1. Ringkasan keputusan

| Area | Keputusan |
|---|---|
| Posisi agent | Aplikasi terpisah dari GezyCBT |
| Telegram/WhatsApp | Dikelola platform agent |
| LLM, prompt, memory | Dikelola platform agent |
| Integrasi utama | HTTPS REST/JSON Agent Integration API |
| Tool adapter | OpenAPI/custom tool/plugin; MCP bridge opsional |
| Cakupan | Semua use case dapat tersedia sebagai capability |
| Izin | Grant eksplisit per client, capability, scope, dan constraint |
| Database | Agent dilarang mengakses MariaDB langsung |
| Tindakan sensitif | Prepare/confirm; R3 dapat memakai approval web |
| Authentication | Machine credential yang dapat dirotasi dan dicabut |
| Correctness | Application service GezyCBT tetap memegang domain rules |
| Infrastruktur | Tanpa Redis, broker, atau microservice baru di GezyCBT |

### 1.1 Arti akses penuh

Agent boleh diberi capability untuk seluruh use case aplikasi: master data, bank soal, soal, ujian, jadwal, monitoring session, hasil, export, audit, dan settings.

Akses penuh tetap melalui API aplikasi. Ia tidak mencakup credential database, SQL bebas, shell VPS, filesystem, backup key, application secret, audit mutation, self-grant, atau kemampuan melewati lifecycle dan invariant domain.

Full-application grant dibuat dari web oleh admin dengan autentikasi ulang, diekspansi menjadi capability eksplisit yang tersedia pada saat grant dibuat, tercatat di audit, dan dapat dicabut kapan saja. Capability yang baru ditambahkan pada release berikutnya tidak otomatis masuk ke full-application grant lama; admin harus meninjau dan memperbarui grant agar fitur baru tidak terekspos tanpa keputusan baru.

### 1.2 Dua lapis pembatas

1. Instruksi percakapan yang dipahami Hivekeep/Hermes.
2. Grant dan policy yang dipaksakan server GezyCBT.

Instruksi kepada agent bukan security boundary. Model dapat salah memahami bahasa atau terkena prompt injection. GezyCBT tetap memeriksa credential, capability, scope, constraint, risiko, target, version, dan lifecycle pada setiap request.

~~~text
capability tersedia
∩ integration grant
∩ resource scope
∩ constraint waktu/batch/data
∩ approval policy
∩ lifecycle dan version resource
= izin efektif
~~~

### 1.3 Single-tenant

- Satu client hanya terhubung ke satu deployment dan satu sekolah.
- Tidak ada tenant selector atau akses lintas sekolah.
- Sekolah lain memerlukan deployment, database, credential, dan backup terpisah.
- Agent boleh berjalan pada host lain, tetapi credential hanya berlaku pada satu GezyCBT.

---

## 2. Pembagian tanggung jawab

### 2.1 Hivekeep/Hermes

Platform agent menangani:

- Telegram, WhatsApp, dan channel lain;
- allowlist/pairing pengguna channel;
- percakapan, memory, prompt, dan LLM;
- natural-language intent dan pemilihan tool;
- penyajian hasil atau file ke chat;
- scheduling agent bila digunakan;
- secret integration client di vault/config platform;
- approval tambahan yang disediakan platform.

### 2.2 GezyCBT

GezyCBT menangani:

- machine authentication;
- capability, grant, scope, dan constraint;
- runtime request validation;
- authorization dan domain invariants;
- transaksi, concurrency, idempotency, dan revision immutability;
- lifecycle exam/schedule dan attempt rules;
- prepare/approve/execute untuk tindakan sensitif;
- audit integration client serta owner;
- controlled export, rate limit, rotation, dan revocation.

### 2.3 Yang tidak dibuat di GezyCBT

- Telegram/WhatsApp webhook;
- channel adapter dan delivery worker;
- conversation orchestrator;
- agent memory atau prompt manager;
- LLM intent parser;
- Telegram/WhatsApp credential;
- agent framework.

Hivekeep menyediakan channel, custom tools, plugin, HTTP tools, MCP, toolboxes, vault, dan human-in-the-loop. Hermes menyediakan messaging gateway, tools/toolsets, skills, command approval, dan MCP. Mengulangnya di GezyCBT akan membuat dua sistem percakapan dan dua jalur security.

---

## 3. Component diagram

~~~mermaid
flowchart LR
    U[Pemilik melalui Telegram/WhatsApp]

    subgraph AGENT[External agent host]
        CH[Messaging gateway]
        LOOP[Hivekeep atau Hermes]
        TOOL[GezyCBT tool/plugin/MCP client]
        VAULT[Credential vault]
    end

    subgraph CBT[GezyCBT single-tenant VPS]
        N[Nginx HTTPS]
        API[Elysia Agent Integration API]
        POLICY[Integration policy]
        APP[Existing application services]
        AUDIT[Audit service]
        EXPORT[Export job]
        DB[(MariaDB)]
        FILES[(Protected files)]
    end

    U <--> CH
    CH <--> LOOP
    LOOP --> TOOL
    VAULT --> TOOL
    TOOL -->|HTTPS + credential + idempotency key| N
    N --> API
    API --> POLICY
    POLICY --> APP
    APP --> DB
    APP --> AUDIT
    AUDIT --> DB
    APP --> EXPORT
    EXPORT --> DB
    EXPORT --> FILES
    API --> TOOL
~~~

### 3.1 Trust boundary

| Komponen | Perlakuan |
|---|---|
| Pesan chat dan attachment | Tidak dipercaya |
| Keputusan LLM | Tidak menjadi authorization |
| Host agent | Dipercaya memegang credential, tetapi request tetap dibatasi |
| Tool/plugin/MCP bridge | Client eksternal, tidak menentukan policy |
| Integration API | Authenticate, validate, authorize, rate-limit |
| Application service | Pemilik business rules |
| MariaDB | Sumber kebenaran |

### 3.2 Alur mutasi

~~~mermaid
sequenceDiagram
    participant U as Pemilik
    participant A as Hivekeep/Hermes
    participant I as Integration API
    participant S as Application service
    participant D as MariaDB

    U->>A: Perintah bahasa alami
    A->>I: Tool request + credential + idempotency key
    I->>I: Authenticate, validate, authorize
    alt Read atau mutation pre-approved
        I->>S: Execute dengan integration actor
        S->>D: Transaction + audit
        S-->>A: Structured result
    else Perlu approval
        I->>D: Simpan exact action plan
        I-->>A: NEEDS_APPROVAL + impact summary
        A-->>U: Minta persetujuan
        U->>A: Setuju
        A->>I: Confirm action
        I->>I: Re-check grant, plan, expiry, version
        I->>S: Execute exact plan
        S->>D: Transaction + audit
        S-->>A: Structured result
    end
~~~

---

## 4. Bentuk integrasi

### 4.1 REST/OpenAPI sebagai kontrak utama

Endpoint resmi memakai prefix:

~~~text
/api/v1/integrations/agent/...
~~~

REST/OpenAPI dipilih karena dapat dipanggil oleh plugin/custom tool Hivekeep, custom tool Hermes, maupun MCP bridge. Ia mudah diuji, diberi authentication, rate limit, idempotency, dan audit. Agent surface memiliki OpenAPI document tersendiri yang hanya berisi endpoint yang sengaja diekspos.

### 4.2 MCP bridge opsional

MCP bridge berjalan di sisi agent/host integrasi dan hanya menerjemahkan tool call menjadi HTTPS request ke Agent Integration API.

~~~text
Hivekeep/Hermes
  -> GezyCBT MCP bridge
    -> Agent Integration API
      -> application service
        -> MariaDB
~~~

MCP bridge:

- tidak mengakses database;
- tidak mengulang business rules;
- menyimpan credential di vault host agent;
- dapat diganti tanpa migration GezyCBT.

REST tetap menjadi kontrak canonical sehingga GezyCBT tidak bergantung pada satu versi MCP atau agent.

### 4.3 Adapter per platform

Untuk Hivekeep, urutan yang disarankan:

1. generic HTTP tool untuk spike;
2. typed custom tool/plugin atau MCP untuk production.

Untuk Hermes:

1. MCP bridge; atau
2. custom tool/skill yang memanggil REST API.

Skill hanya menjelaskan prosedur. Credential tidak ditulis di skill, prompt, memory, repository, atau chat.

---

## 5. Integration client dan authentication

### 5.1 Client

External agent direpresentasikan sebagai integration client, bukan role manusia.

~~~text
name: Personal Teacher Agent
platform_hint: HIVEKEEP
owner_user_id: 42
status: ACTIVE
~~~

Owner dapat berupa admin atau guru. Client milik guru tidak boleh memiliki capability, scope, atau constraint yang melampaui authorization guru tersebut. Effective permission selalu merupakan irisan grant integration dan scope owner saat request dijalankan.

Jika owner dinonaktifkan, seluruh client dan credential miliknya langsung dinonaktifkan dan action yang masih pending berubah menjadi `CANCELLED` dengan reason sistem. Reaktivasi owner tidak otomatis mengaktifkan client atau credential; admin harus mengaktifkannya kembali secara eksplisit setelah review.

### 5.2 Pembuatan credential

1. Admin membuat integration client melalui web.
2. Admin memilih capability, scope, constraint, dan expiry.
3. Admin melakukan autentikasi ulang.
4. Server menghasilkan credential acak minimal 256 bit.
5. Plaintext ditampilkan sekali.
6. Database menyimpan prefix pengenal dan digest.
7. Pemilik memasukkannya melalui secure input/vault Hivekeep atau Hermes.

Credential tidak pernah dikirim melalui chat.

### 5.3 Request

~~~text
Authorization: Bearer <integration-credential>
Idempotency-Key: <unique-operation-id>
X-GezyCBT-Client-Version: <adapter-version>
Content-Type: application/json
~~~

Endpoint integration tidak memakai cookie atau CSRF. HTTPS wajib. Server memeriksa active, expiry, revoked status, client, grant, dan request schema. Header credential selalu direduksi dari log.

`Idempotency-Key` wajib hanya untuk mutation. Read request tidak memerlukannya; bila dikirim, server mengabaikannya dan tidak membuat idempotency record.

`X-GezyCBT-Client-Version` opsional tetapi disarankan untuk diagnosis compatibility. Server mencatatnya hanya pada telemetry atau audit yang memang dibuat untuk request tersebut dan tidak otomatis menolak client lama. Bila ada minimum adapter version akibat perubahan breaking, response dapat membawa `X-GezyCBT-Min-Client-Version`; adapter yang lebih lama wajib mencatat warning dan menghentikan tool yang tidak kompatibel sampai diperbarui.

### 5.4 Rotasi dan revoke

- Current dan next credential boleh overlap singkat selama rotasi.
- Plaintext credential baru hanya tampil sekali.
- Emergency revoke berlaku pada request berikutnya.
- Pending action dan unused export token terkait ikut invalid.
- Kill switch tersedia di web GezyCBT, tanpa bergantung pada agent.

Optional IP allowlist hanya dipakai jika host agent mempunyai outbound IP stabil. mTLS dapat ditambahkan bila dibutuhkan, tetapi tidak wajib pada versi awal.

---

## 6. Capability dan authorization

| Kelompok | Contoh capability |
|---|---|
| Users | users.read/create/update/disable/reset_password |
| Akademik | classes.read/write, subjects.read/write, teacher_scopes.read/write |
| Soal | question_banks.read/write, questions.read/read_key/create/update/archive/publish, media.upload |
| Ujian | exams.read/create/update/archive/attach_questions/publish |
| Jadwal | schedules.read/create/update/activate/close/rotate_token |
| Session | sessions.read/monitor/extend_time/end/reset_attempt |
| Hasil | results.read/read_practice/release/unrelease/export |
| Operasional | audit.read, settings.read/write |

`questions.read` hanya memberikan isi soal tanpa answer key. Pembacaan key memerlukan `questions.read_key`, tetap dibatasi scope, dan diaudit sebagai sensitive read. Search/list tidak pernah memuat answer key. Tool create/update dapat menerima key sebagai input sesuai capability write, tetapi response tetap meredaksi key jika client tidak mempunyai `questions.read_key`.

`settings.read/write` hanya mencakup field allowlist pada singleton `school_settings`, yaitu nama sekolah, alamat, dan logo pada baseline. Zona waktu dapat dibaca tetapi tetap terkunci ke `Asia/Jakarta` sesuai keputusan produk; mengubahnya memerlukan perubahan keputusan arsitektur. Capability ini tidak pernah mencakup integration client, credential, grant, policy keamanan, secret, atau konfigurasi server.

Tidak pernah tersedia: raw SQL, shell, secret, backup key, audit mutation, atau mutation integration client/credential/grant dari agent. Pengelolaan integration tetap hanya melalui web admin.

### 6.1 Scope

Grant dapat dibatasi ke seluruh sekolah, subject, class, question bank, exam, schedule, resource milik owner, academic year, atau daftar stable ID.

### 6.2 Constraint

- expiry dan allowed hours;
- maximum bulk items;
- publish allowed/denied;
- active-exam operation allowed/denied;
- result PII export allowed/denied;
- maximum export rows;
- maximum time extension;
- action count per hour.

Setiap perubahan capability, scope, constraint, validity, atau status grant menaikkan `grant_version`. Exact action plan menyimpan version saat dibuat. Confirm ditolak dengan `ACTION_GRANT_CHANGED` jika version aktif berbeda, sekalipun perubahan tampak memperluas izin; pemilik harus membuat plan baru terhadap grant terbaru.

### 6.3 Risk level

| Level | Contoh | Perilaku |
|---|---|---|
| R0 | Search, daftar, summary | Execute langsung |
| R1 | Membuat/mengubah draft | Execute jika pre-approved |
| R2 | Bulk attach, publish, export | Prepare lalu confirm |
| R3 | Tutup Jadwal aktif, Akhiri Sesi, reset attempt, release result, disable user, export PII | Web approval atau konfirmasi kuat |
| R4 | Self-grant, SQL, shell, secret, audit delete | Selalu ditolak |

Risiko dapat naik menurut state. Perubahan schedule draft mungkin R1; perubahan schedule dengan session aktif menjadi R3.

R1 dianggap pre-approved hanya jika constraint grant untuk capability tersebut memuat `auto_approve_r1: true`; baseline default-nya true. Admin dapat mengubahnya menjadi false untuk client yang memerlukan jejak persetujuan lebih ketat. Jika false, R1 mengikuti prepare/confirm seperti R2.

---

## 7. Desain tools

Tools mewakili use case, bukan tabel.

Tool yang baik:

- search_questions;
- create_question_draft;
- update_question_draft;
- validate_question_revision;
- add_questions_to_exam_draft;
- get_schedule_result_summary;
- request_result_export.

Tool yang dilarang:

- execute_sql;
- update_any_table;
- run_admin_command;
- generic internal API write.

### 7.1 Tool set awal

**Discovery:** get_current_integration, list_capabilities, search_subjects, search_classes, search_question_banks, search_questions, search_exams, search_schedules.

**Question authoring:** get_question, get_question_key, upload_question_media, create_question_draft, update_question_draft, validate_question_draft, archive_question, publish_question_revision.

**Exam authoring:** get_exam, create_exam_draft, create_exam_revision, add/remove/reorder_exam_questions, validate_exam_revision, publish_exam_revision.

**Results:** get_schedule_summary, list_schedule_results, list_practice_results, get_participant_result, request_result_export, get_export_status, create_export_download_link.

**High risk:** prepare_result_release, prepare_schedule_close, prepare_session_time_extension, prepare_session_end, prepare_attempt_reset, get_action_status, confirm_action.

High-risk tools dapat tidak dipasang di toolbox agent hingga benar-benar dibutuhkan.

Agent disarankan memanggil `GET /me` dan `GET /capabilities` saat startup, setelah credential dirotasi, dan setelah menerima `CAPABILITY_DENIED` atau `ACTION_GRANT_CHANGED`. Capability dapat berubah saat runtime. Error tersebut membawa `grantVersion` terbaru dan `refreshCapabilities: true`, bukan menyalin seluruh daftar capability; agent kemudian mengambil ulang endpoint discovery authoritative.

### 7.2 Stable ID dan version

Agent boleh mencari berdasarkan nama, tetapi mutation memakai stable ID. Search mengembalikan maksimal 20 kandidat per page dengan cursor. Jika hasil lebih dari 20, response membawa `nextCursor` dan tidak melakukan auto-select. Tepat satu kandidat boleh ditampilkan sebagai kandidat tunggal, tetapi mutation tetap memakai stable ID. Jika ada lebih dari satu kandidat, agent dilarang memilih otomatis dan harus meminta pemilik memilih atau mempersempit pencarian.

Response ambiguity minimal memuat `code: AMBIGUOUS_RESOURCE`, jenis resource, candidate stable ID, display label, disambiguating fields yang aman, dan pagination cursor. Candidate response tidak memuat answer key, PII yang tidak diperlukan, atau field di luar capability client.

Update membawa expectedVersion. Bila resource sudah berubah, server menolak dengan conflict. Agent mengambil data terbaru dan meminta keputusan baru.

### 7.3 Response

~~~json
{
  "ok": true,
  "data": {},
  "requestId": "req_...",
  "auditId": "aud_...",
  "warnings": [],
  "nextAction": null
}
~~~

Error memiliki stable code seperti CAPABILITY_DENIED, RESOURCE_SCOPE_DENIED, RESOURCE_VERSION_CONFLICT, ACTION_APPROVAL_REQUIRED, atau RATE_LIMITED.

---

## 8. Alur fitur

### 8.1 CRUD soal

Agent mengumpulkan tipe, bank, stimulus, prompt, opsi/pernyataan, dan key; lalu memanggil create_question_draft. GezyCBT memvalidasi dan membuat draft.

- SINGLE_CHOICE: 2–10 opsi dan tepat satu key.
- MULTIPLE_RESPONSE: 2–10 opsi, minimal satu key, exact match.
- TRUE_FALSE: tepat tiga pernyataan, masing-masing TRUE/FALSE, exact match.

Publish selalu action terpisah. Published revision tidak dimutasi; perubahan membuat draft revision baru.

Upload media memakai capability `media.upload` dan pipeline yang sama dengan UI web: hanya JPEG, PNG, atau WebP; maksimum awal 2 MiB dan 2.500 × 2.500 pixel; validasi MIME serta magic bytes; decode/re-encode bila policy mengharuskan; nama storage acak; dan alt text atau penanda dekoratif wajib saat media ditempelkan ke revision. SVG, HTML, video, dan audio ditolak pada baseline. Upload yang berhasil belum otomatis menempelkan asset ke soal.

### 8.2 Memasukkan soal ke ujian

1. Agent memilih logical exam dan draft revision.
2. Agent mencari published question revisions.
3. Request membawa IDs, expected version, posisi, dan points.
4. Server memeriksa scope, duplicate, status DRAFT, dan points.
5. Batch material menghasilkan R2 action plan.
6. Setelah approval, exact target set dieksekusi.

Published exam tidak diubah langsung.

### 8.3 Melihat hasil

Summary dapat memuat target, belum mulai, active, submitted, expired, nilai agregat, dan release status. Detail peserta memakai capability terpisah dan pagination. Aggregate response tidak memuat PII.

Hasil ujian utama memakai `results.read`. Hasil latihan memakai capability terpisah `results.read_practice` karena memuat identity snapshot tamu. Response hasil latihan mengikuti kontrak domain yang sama dengan UI peserta, termasuk `canRetry` dan `canRetryReason` (`SCHEDULE_CLOSED`, `ATTEMPT_LIMIT_REACHED`, atau `TOKEN_INVALID_OR_EXPIRED`), tetapi tidak memuat answer key atau correctness per soal. Identity dan detail result tetap mengikuti scope serta minimisasi PII.

### 8.4 Export

1. Agent meminta export dengan filter, format, dan kolom.
2. Server memeriksa scope dan risiko PII.
3. Jika perlu, server membuat action plan.
4. Export job berjalan asynchronous ke protected storage.
5. Agent polling dengan backoff.
6. Server membuat one-time download URL yang berlaku maksimum 5 menit.
7. Agent mengunduh dan mengirim file melalui channel miliknya.

GezyCBT tidak mengirim file langsung ke Telegram/WhatsApp.

Download token hanya dapat dipakai satu kali, terikat pada client, owner, export file, dan scope saat token dibuat. Setelah digunakan atau kedaluwarsa, agent harus meminta token baru dan authorization diperiksa ulang.

### 8.5 Ujian aktif

Tutup Jadwal, Perpanjang Waktu, Akhiri Sesi, reset attempt, atau release result memakai plan yang memuat stable target, before/after, jumlah peserta terdampak, reason, expected state/version, grant version, hash, dan expiry.

**Akhiri Sesi** hanya menargetkan satu session dan menghasilkan `finalization_reason=STAFF_END`. **Tutup Jadwal** menargetkan schedule serta session aktif di dalamnya dan menghasilkan `finalization_reason=SCHEDULE_CLOSE`. Agent tidak dapat mengirim atau menetapkan nilai finalization reason lain; server menentukannya dari use case. `finalization_note` berasal dari reason administratif tetapi tidak tersedia melalui Agent Integration API.

Read model session/result dapat memuat safe enum `PARTICIPANT_SUBMIT`, `DEADLINE`, `STAFF_END`, `SCHEDULE_CLOSE`, atau `RESET_ATTEMPT`. Enum menjelaskan penyebab finalisasi dan tidak menyatakan bahwa hasil sudah dirilis.

Reset attempt mengikuti aturan web admin: session aktif difinalisasi dengan `RESET_ATTEMPT`, session yang sudah final tidak ditulis ulang, lalu server membuat tepat satu `exam_attempt_grant`. Grant dikonsumsi secara atomik oleh tepat satu replacement session. Agent tidak dapat membuat grant secara langsung atau membuat lebih dari satu grant belum terpakai untuk pasangan schedule/peserta.

---

## 9. Confirmation dan approval

GezyCBT menyimpan exact action plan. Langkah confirm tidak menerima parameter domain baru, sehingga agent tidak dapat mengubah makna setelah pemilik menyetujui.

~~~text
PLANNED
  -> AWAITING_CONFIRMATION
  -> EXECUTING
  -> SUCCEEDED
  -> FAILED

Terminal: REJECTED, CANCELLED, EXPIRED
~~~

Exact action plan minimal memuat:

- capability dan operation stabil;
- target resource type serta stable ID;
- expected resource version/state;
- parameter domain immutable yang akan dieksekusi;
- before/after aman dan ringkasan dampak, termasuk jumlah row/peserta;
- risk level dan approval method;
- client ID, owner ID, serta grant version;
- created time dan expiry.

Server menghitung `plan_hash` sebagai SHA-256 dari canonical JSON plan. Canonical representation mengurutkan object key secara alfabetis pada setiap level, mempertahankan urutan array, memakai UTF-8, tanpa whitespace/comment, memakai JSON string escaping standar, menolak `NaN`/infinity, menyimpan stable ID sebagai string, dan menormalkan angka desimal tanpa notasi eksponensial melalui serializer server yang sama. Server mengembalikan hash tersebut; agent hanya menggemakan `planHash` dan tidak perlu menghitung ulang.

Untuk R2:

1. Agent memanggil prepare.
2. Server mengembalikan action ID, `planHash`, impact summary, expiry, dan approval method.
3. Agent meminta persetujuan pemilik.
4. Agent memanggil confirm dengan action ID dan `planHash`; tidak ada parameter domain lain.
5. Server memeriksa client, action, plan hash, expiry, grant version, dan target version.

Untuk R3, server dapat memberi one-time web approval URL. Pemilik login/step-up pada GezyCBT dan menyetujui exact plan. Agent hanya melakukan polling status.

Action invalid bila credential/grant/client/owner dinonaktifkan, expired, target berubah, scope berubah, atau action sudah terminal.

GezyCBT tidak mengirim webhook atau callback ke Hivekeep/Hermes. Agent memeriksa status melalui `GET /actions/:id` dengan backoff dan dapat melanjutkan polling setelah kembali online. Saat startup/reconnect, agent dapat mengambil action milik client yang masih pending melalui `GET /actions?status=AWAITING_CONFIRMATION`; endpoint ini cursor-paginated dan tidak dapat melihat action client lain. Action pending berlaku 30 menit secara default; sesudah `expires_at`, server mengubahnya menjadi `EXPIRED` secara idempotent dan confirm ditolak. Action expired harus dipersiapkan ulang agar target, version, grant, dan dampaknya dinilai kembali.

---

## 10. Database

### 10.1 integration_clients

ID, name, platform_hint, owner_user_id, status, description, policy_version, created_by, timestamps, dan last_used_at.

### 10.2 integration_credentials

Client ID, token_prefix, token_digest, status, valid_from, expires_at, last_used_at, revoked metadata, dan rotation parent. Plaintext tidak disimpan.

### 10.3 integration_grants

Client, capability, scope type/ID, normalized scope JSON, validated constraints, grant version, issuer, validity, revoke metadata, dan reason.

Grant version dimulai dari 1 dan bertambah pada setiap perubahan capability, scope, constraint, validity, atau status. Perubahan dilakukan dengan optimistic concurrency agar dua edit web tidak saling menimpa.

### 10.4 integration_idempotency_keys

Client, key, operation, request hash, status, response reference, expiry, dan created_at. Unique client+key. Key sama dengan body berbeda ditolak.

### 10.5 agent_action_requests

Client, owner, capability, normalized plan, plan hash, risk, expected versions, grant version, status, approval method, expiry, timestamps, result reference, dan error code.

`normalized_plan` mengikuti exact action plan section 9 dan immutable setelah dibuat. Confirm membandingkan action ID, stored plan hash, echoed `planHash`, grant version, serta expected target versions sebelum status dapat berpindah ke `EXECUTING`.

### 10.6 agent_action_approvals

Action, approved user bila web approval, approval source, plan hash, approved/consumed timestamps, dan outcome.

### 10.7 export_jobs/export_files dan audit

Export mencatat integration client serta owner. Download token disimpan sebagai digest.

Audit mencatat actor_user_id sebagai owner/delegator, actor_type EXTERNAL_AGENT, integration_client_id, optional action_request_id, request ID, capability, entity, dan reduced before/after.

Successful discovery, search, list, status polling, dan read umum tidak membuat audit row per request. Authentication failure, capability/scope denial, sensitive read (`questions.read_key`, hasil individual/PII), mutation, action plan, approval, export creation, download, credential/grant change, serta revoke tetap diaudit. Metric request dan access log tereduksi tetap dapat menghitung read traffic tanpa memenuhi tabel audit.

Audit agent mengikuti retention audit sekolah, minimal satu tahun. Detail `agent_action_requests` dipertahankan minimum 90 hari. Sebelum detail action dihapus, audit log sudah menyimpan ringkasan immutable berupa plan hash, capability, target type/ID, risk, approver bila ada, outcome, dan request/action ID. Audit viewer tetap dapat menjelaskan tindakan setelah normalized plan rinci melewati masa retensi.

### 10.8 Index minimum

| Tabel | Index |
|---|---|
| integration_clients | owner+status, status+last_used |
| integration_credentials | token_prefix unique, client+status+expiry |
| integration_grants | client+capability+status+expiry, scope lookup |
| integration_idempotency_keys | client+key unique, expiry |
| agent_action_requests | client+created, status+expiry, owner+created |
| agent_action_approvals | action+outcome, approved_by+created |
| export_jobs | requester/client+created, status+created, expiry |

Transaction boundary mencakup credential/grant+audit, idempotency reservation+domain mutation+outcome, approval consumption+action compare-and-set+domain transaction, serta export completion+file metadata. Jangan menahan transaction saat memanggil platform agent atau membuat file besar.

---

## 11. API surface

Section C.17 pada dokumen arsitektur menetapkan boundary dan daftar minimum surface awal, lalu mendelegasikan kontrak rinci ke dokumen ini. Karena itu, daftar pada section 11 adalah inventaris endpoint integration yang lengkap untuk baseline bot, termasuk endpoint pendukung lifecycle action dan export yang tidak diulang pada tabel ringkas C.17. Perubahan path atau semantics pada daftar ini tetap memerlukan review arsitektur sebelum implementasi.

### 11.1 Integration

~~~text
GET /api/v1/integrations/agent/me
GET /api/v1/integrations/agent/capabilities
~~~

`/me` mengembalikan identity client, owner summary aman, status, `grantVersion`, dan nama effective capabilities. `/capabilities` menjadi sumber rinci untuk scope, constraints, validity, dan policy metadata yang diizinkan.

### 11.2 Questions

~~~text
GET  /api/v1/integrations/agent/question-banks
GET  /api/v1/integrations/agent/questions
GET  /api/v1/integrations/agent/questions/:id
POST /api/v1/integrations/agent/questions
POST /api/v1/integrations/agent/questions/:id/revisions
PATCH /api/v1/integrations/agent/question-revisions/:id
POST /api/v1/integrations/agent/question-revisions/:id/validate
POST /api/v1/integrations/agent/question-revisions/:id/publish
POST /api/v1/integrations/agent/media
~~~

Upload media memakai `multipart/form-data`, capability `media.upload`, body limit khusus upload, dan pipeline keamanan yang sama dengan upload UI. Response hanya memuat asset metadata aman dan stable media ID.

### 11.3 Exams

~~~text
GET/POST /api/v1/integrations/agent/exams
GET      /api/v1/integrations/agent/exams/:id
POST     /api/v1/integrations/agent/exams/:id/revisions
PATCH    /api/v1/integrations/agent/exam-revisions/:id
POST     /api/v1/integrations/agent/exam-revisions/:id/questions
DELETE   /api/v1/integrations/agent/exam-revisions/:id/questions/:questionId
POST     /api/v1/integrations/agent/exam-revisions/:id/validate
POST     /api/v1/integrations/agent/exam-revisions/:id/publish
~~~

### 11.4 Results, exports, actions

~~~text
GET  /api/v1/integrations/agent/schedules/:id/summary
GET  /api/v1/integrations/agent/schedules/:id/results
POST /api/v1/integrations/agent/schedules/:id/exports
GET  /api/v1/integrations/agent/exports/:id
POST /api/v1/integrations/agent/exports/:id/download-token
POST /api/v1/integrations/agent/actions/prepare
GET  /api/v1/integrations/agent/actions?status=:status
GET  /api/v1/integrations/agent/actions/:id
POST /api/v1/integrations/agent/actions/:id/confirm
POST /api/v1/integrations/agent/actions/:id/cancel
~~~

### 11.5 Web management

~~~text
GET/POST /api/v1/admin/integration-clients
GET/PATCH /api/v1/admin/integration-clients/:id
POST      /api/v1/admin/integration-clients/:id/credentials
DELETE    /api/v1/admin/integration-clients/:id/credentials/:credentialId
GET/POST  /api/v1/admin/integration-clients/:id/grants
DELETE    /api/v1/admin/integration-clients/:id/grants/:grantId
GET       /api/v1/admin/integration-actions
GET       /api/v1/admin/integration-actions/:id
POST      /api/v1/admin/integration-actions/:id/approve
~~~

Web management memakai staff session, CSRF, authorization, dan step-up.

---

## 12. Security dan privacy

| Ancaman | Kontrol |
|---|---|
| Credential bocor | Digest, vault, expiry, rotation, revoke |
| LLM memilih tool salah | Typed schema, scope, plan, version, approval |
| Prompt injection | Server allowlist use case; tidak mengikuti prompt |
| Replay | Idempotency key, request hash, action state |
| Agent mengubah izin | Grant/credential hanya melalui web |
| Salah target | Stable ID dan ambiguity response |
| Bulk destructive | Limit, exact target preview, approval |
| PII export | Capability khusus dan expiring download |
| IDOR | Resource policy dan scoped query |
| Secret masuk log | Header redaction dan negative tests |
| Agent host compromised | Kill switch, revoke, invalidate, audit |

Operator agent wajib memakai vault, membatasi pengguna/channel, memasang hanya tools yang diperlukan, mengaudit scheduled automation, dan tidak mengirim PII ke grup publik.

Search/list tidak pernah mengembalikan answer key. Read key memakai endpoint/detail field yang dilindungi `questions.read_key`, scope, dan sensitive-read audit; authoring tool tanpa capability tersebut tidak dapat membaca key yang sudah tersimpan. Summary tidak memuat PII. Credential, password, token ujian plaintext, atau secret tidak pernah masuk response.

`finalization_note` tidak tersedia melalui Agent Integration API, termasuk pada session detail, result, action status, atau error response. Agent hanya dapat menerima safe `finalization_reason` yang dibutuhkan untuk menjelaskan state domain. Reason yang baru saja diajukan agent boleh dipantulkan pada response prepare sebagai bagian exact plan sebelum eksekusi, tetapi stored note tidak dapat dibaca kembali sebagai field session.

---

## 13. Reliability dan performance

Integration API stateless pada Bun process. Credential, grant, idempotency, action, export, dan audit authoritative berada di MariaDB.

Hivekeep/Hermes disarankan berjalan pada host terpisah. Dengan demikian VPS GezyCBT 2 GB tidak menanggung LLM runtime, conversation history, atau channel gateway. Jika ditempatkan pada VPS fisik yang sama, memory budget dan load test harus diulang; 2 GB kemungkinan tidak nyaman.

Prioritas resource:

1. start/autosave/submit/resume peserta;
2. participant login/read;
3. staff web;
4. agent read/write;
5. export/report berat.

Semua mutation agent wajib membawa idempotency key. Export berjalan asynchronous, concurrency awal 1, streaming/paginated, mempunyai quota/expiry, dan dapat ditunda saat exam load tinggi.

GezyCBT tetap berfungsi penuh jika platform agent mati. Tidak ada data domain yang hanya authoritative di memory agent.

Baseline rate limit per active integration client:

| Scope | Baseline |
|---|---:|
| Agent read | 60 request/menit |
| Agent mutation | 20 request/menit |
| Export creation | 3 request/10 menit dan maksimum 1 job aktif per client |
| Authentication failure per credential fingerprint | 5 kegagalan/15 menit |

Limit diterapkan setelah Nginx connection/body protection dan sebelum pekerjaan database berat. Response memakai `429` serta `Retry-After`. Polling action/export harus memakai backoff dan jitter; agent tidak boleh menghabiskan seluruh read budget hanya untuk status polling. Nilai ini adalah starting point dan wajib dituning melalui load test tanpa mengorbankan endpoint ujian.

---

## 14. Testing

### Unit

- credential verification;
- capability/scope/constraint;
- risk classifier;
- plan hash;
- idempotency request hash;
- action state;
- response redaction.

### Integration

- active/expired/revoked credential;
- full dan limited grant;
- scope negative test;
- duplicate mutation;
- same key/different body;
- concurrent confirmation;
- revoke saat menunggu;
- version conflict;
- revision immutability;
- transaction rollback;
- export authorization/expiry;
- owner dinonaktifkan membatalkan pending action dan menonaktifkan client;
- grant version berubah setelah prepare menghasilkan `ACTION_GRANT_CHANGED`;
- action melewati 30 menit menjadi `EXPIRED` dan tidak dapat dikonfirmasi;
- reset attempt membuat satu grant yang hanya dikonsumsi satu replacement session;
- Akhiri Sesi dan Tutup Jadwal menghasilkan finalization reason yang tepat;
- rate limit agent mengembalikan `429` dan `Retry-After`.

### Contract dan E2E

- OpenAPI generated client;
- Hivekeep and Hermes/MCP fixtures;
- create/edit tiga tipe soal;
- add question ke draft exam;
- result summary/export;
- R2 confirmation;
- R3 web approval;
- immediate revoke;
- answer-key leakage negative test;
- `questions.read_key` menghasilkan sensitive-read audit;
- practice result memuat `canRetry`/`canRetryReason` tanpa answer key atau correctness per soal;
- canonical plan fixtures menghasilkan hash stabil dan perubahan satu parameter mengubah hash.

`GET /api/v1/integrations/agent/me` menjadi self-service smoke test tanpa mutation. Response memuat identity client, owner summary aman, status, effective grant version, dan nama effective capabilities; `/capabilities` memberi rincian scope/constraint. Admin atau operator menjalankannya sebelum memasang tool mutation. Test setup dinyatakan berhasil hanya jika kedua response sesuai grant yang terlihat pada web admin.

### Load isolation

- agent burst saat 1.000 participant autosave;
- polling export berlebihan;
- report saat exam active;
- oversized batch;
- authentication failure burst;
- exam SLO tetap terpenuhi.

---

## 15. Deployment

~~~text
Host/VPS Agent
  Hivekeep atau Hermes
  GezyCBT tool/plugin/MCP bridge
  credential vault
          |
          | HTTPS
          v
VPS GezyCBT 2 GB
  Nginx
  Bun/Elysia
  MariaDB
  protected media/exports
~~~

Agent tidak mendapat network access ke MariaDB. GezyCBT tidak membutuhkan TELEGRAM_BOT_TOKEN atau WHATSAPP credential.

### 15.1 Compatibility matrix

| Komponen | Versi minimum/baseline | Verifikasi wajib |
|---|---|---|
| Hivekeep | TBD pada integration spike | HTTP/custom tool atau plugin, vault, approval, file download, dan reconnect polling |
| Hermes Agent | TBD pada integration spike | MCP/custom tool, secret storage, command approval, file handling, dan reconnect polling |
| MCP protocol | TBD hanya bila bridge dipakai | Tool schema, error mapping, cancellation, pagination, dan file/resource transfer |
| Bun | Sama dengan exact version yang dipin project inti | HTTPS client/server behavior, streaming upload/download, crypto, dan generated client |
| Elysia | Sama dengan exact version yang dipin project inti | Validation, multipart limit, OpenAPI, auth middleware, dan error contract |
| MariaDB | Sama dengan versi production yang lulus compatibility spike | Transaction, row lock, unique constraint, JSON, expiry query, dan concurrency |

Nilai TBD harus diselesaikan pada I2 sebelum adapter production dipilih. Hasil spike dicatat sebagai versi exact yang diuji; upgrade salah satu komponen mengulang contract dan compatibility tests yang terdampak.

Metric minimum: authentication outcome, latency/error per capability, policy allow/deny, idempotent replay/conflict, pending/expired action, export duration/size, integration DB-pool wait, serta dampaknya pada exam endpoint.

Correlation:

~~~text
external tool call ID
-> GezyCBT request ID
-> idempotency key/action ID
-> audit ID
-> domain resource
~~~

---

## 16. Tahapan implementasi

### I0 — Agent-ready domain foundation

- business logic berada di application service;
- application service tidak bergantung pada HTTP/Vue;
- actor context mendukung EXTERNAL_AGENT;
- mutation penting mendukung idempotency;
- audit membedakan human, agent, dan system job;
- export menjadi controlled job;
- DTO participant, staff, dan agent dipisahkan.

Inilah arti “fondasi disiapkan sejak awal”. GezyCBT tidak membuat bot percakapan.

### I1 — Integration security

Integration clients, credential issue/rotate/revoke, grants, scope, web management, audit, dan kill switch.

### I2 — Read-only tools

Capabilities, search bank/soal/ujian/schedule, summary hasil, OpenAPI integration document, serta spike Hivekeep dan Hermes.

### I3 — Question authoring

CRUD draft tiga tipe soal, media upload, validation, version conflict, dan idempotency.

### I4 — Exam authoring

Exam/revision, attach/remove/reorder, points, readiness validation, dan R2 publish.

### I5 — Results/export

Summary/detail sesuai scope, controlled export, one-time download, PII grant, dan load isolation.

### I6 — High-risk

Prepare/confirm, web approval, schedule close, result release, session extension, session end, reset attempt, dan incident runbook.

### I7 — Production adapters

Typed Hivekeep tool/plugin atau MCP bridge, Hermes MCP/custom tool, skills/tool descriptions, vault setup, allowed-user policy, contract/E2E/security tests, dan pinned compatibility versions.

I0 dibangun bersama core. I1–I2 dimulai setelah auth/read models stabil. I3 mengikuti question bank, I4 mengikuti exam authoring, I5 mengikuti results, dan I6 terakhir. Agent dapat dipakai untuk CRUD soal setelah module soal stabil tanpa menunggu seluruh fitur berisiko tinggi selesai.

---

## 17. Acceptance criteria

1. Hivekeep/Hermes terpisah dari process dan database GezyCBT.
2. GezyCBT tidak menyimpan credential Telegram/WhatsApp.
3. Agent hanya memakai dedicated Integration API.
4. Machine credential tersimpan sebagai digest; plaintext di vault agent.
5. Seluruh request melewati capability dan resource policy.
6. Full grant hanya dibuat/dicabut dari web.
7. Agent tidak dapat mengubah grant/credential sendiri.
8. Mutation retry tidak membuat data ganda.
9. Published revision tetap immutable.
10. High-risk action mengeksekusi exact approved plan.
11. Revoke berlaku pada request berikutnya.
12. Mutation dapat ditelusuri ke owner, client, capability, request, dan audit.
13. PII/export memakai izin khusus serta expiring download.
14. Agent outage tidak mengganggu CBT.
15. Agent traffic tidak membuat exam runtime melanggar SLO.
16. REST contract dapat dipakai Hivekeep dan Hermes.
17. MCP bridge dapat diganti tanpa mengubah domain/schema CBT.
18. Full-application grant lama tidak memperoleh capability baru secara otomatis.
19. Owner yang dinonaktifkan mematikan client dan membatalkan action pending.
20. Search ambigu tidak pernah memilih target otomatis saat kandidat lebih dari satu.
21. `questions.read` dan search/list tidak membocorkan answer key.
22. Akhiri Sesi, Tutup Jadwal, dan reset attempt mengikuti finalization serta attempt-grant domain yang sama dengan web.
23. Action dapat dipulihkan melalui polling setelah agent offline dan tidak dapat dikonfirmasi setelah expiry.
24. Successful status polling tidak memenuhi audit log, sementara sensitive read dan mutation tetap terlacak.
25. Download token berlaku maksimal lima menit, sekali pakai, dan authorization diperiksa ulang.

---

## 18. Keputusan baseline

| ID | Keputusan |
|---|---|
| AI-01 | Hivekeep/Hermes eksternal; GezyCBT tidak membuat bot/channel gateway |
| AI-02 | REST/OpenAPI menjadi canonical integration contract |
| AI-03 | MCP bridge opsional dan berada di sisi agent |
| AI-04 | Integration client adalah actor teknis, bukan human role |
| AI-05 | Full scope tersedia melalui explicit full-application grant |
| AI-06 | Agent tidak mendapat DB/shell/secret/audit-mutation access |
| AI-07 | Mutation memakai idempotency dan application service |
| AI-08 | R2 memakai stored action plan; R3 dapat membutuhkan web approval |
| AI-09 | Agent host disarankan terpisah dari VPS GezyCBT 2 GB |
| AI-10 | Tools dirilis mengikuti kesiapan domain |
| AI-11 | Full grant adalah snapshot capability eksplisit; capability baru memerlukan review admin |
| AI-12 | Ordinary read memakai metric/access log tereduksi; sensitive read dan mutation memakai audit |
| AI-13 | Tidak ada webhook GezyCBT ke agent; action/export dipantau dengan polling dan backoff |

## 19. Risiko dan mitigasi

| Risiko | Mitigasi |
|---|---|
| Credential bocor | Vault, expiry, rotate/revoke, scope, audit |
| Agent salah memahami | Typed tool, stable ID, version, prepare/confirm |
| Platform berubah | REST/OpenAPI, adapter boundary, contract tests |
| Tool terlalu luas | Fine-grained use-case tools |
| Prompt injection | Server-side capability/schema/domain checks |
| Agent satu VPS | Separate host atau tambah resource dan load test |
| Export membebani DB | Async, limits, concurrency 1, priority |
| R3 salah approve | Exact summary dan web approval |
| PII tersimpan di memory | Minimized response dan platform retention policy |
| Agent tidak dapat diakses | Independent web kill switch |

---

## Referensi

- [Hivekeep repository](https://github.com/MarlBurroW/hivekeep)
- [Hivekeep documentation](https://marlburrow.github.io/hivekeep/)
- [Hermes Agent repository](https://github.com/nousresearch/hermes-agent)
- [Hermes Agent documentation](https://hermes-agent.nousresearch.com/docs/)
- [Hermes MCP Integration](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp)

Dukungan plugin, MCP, tools, messaging, approval, dan vault wajib diverifikasi lagi saat adapter dibuat. GezyCBT tidak bergantung pada fitur platform yang belum dibuktikan melalui integration spike.

## Batas rancangan

Dokumen ini belum memilih Hivekeep atau Hermes karena GezyCBT sebaiknya kompatibel dengan keduanya. Bahasa MCP bridge, exact token format, dan package adapter dipilih melalui spike tanpa mengubah prinsip: canonical REST API, explicit grants, no direct database access, idempotency, server-side domain rules, audit, dan approval untuk tindakan sensitif.
