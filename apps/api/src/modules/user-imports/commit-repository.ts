import {
  formatId,
  formatUtcTimestamp,
  type Id,
  parseId,
  parseUtcTimestamp,
  type UtcTimestamp,
} from "@gezycbt/contracts";
import {
  CredentialArtifactExpiredError,
  CredentialArtifactNotFoundError,
  type ImportCommitResult,
  type ImportFieldError,
  ImportPreviewAlreadyCommittedError,
  ImportPreviewBlockingError,
  ImportPreviewCommitConflictError,
  ImportPreviewExpiredError,
  ImportPreviewNotFoundError,
  type PreviewRow,
} from "./domain";
import type {
  ImportRepositoryConnection,
  ImportRepositoryDatabase,
} from "./repository";

export interface PreparedImportCredential {
  readonly rowNumber: number;
  readonly username: string;
  readonly usernameNormalized: string;
  readonly displayName: string;
  readonly classId: Id | null;
  readonly passwordHash: string;
}

export interface ImportCommitDatabaseInput {
  readonly ownerUserId: Id;
  readonly previewId: Id;
  readonly commitTokenHash: Uint8Array;
  readonly idempotencyHash: Uint8Array;
  readonly committedByUserId: Id;
  readonly requestId: string;
  readonly artifactPayload: Uint8Array;
  readonly artifactExpiresAt: UtcTimestamp;
  readonly credentials: readonly PreparedImportCredential[];
}

export interface CredentialArtifactPayloadRecord {
  readonly artifactId: Id;
  readonly ownerUserId: Id;
  readonly encryptedPayload: Uint8Array;
  readonly expiresAt: UtcTimestamp;
}

export interface UserImportCommitRepository {
  getCommitRows(
    ownerUserId: Id,
    previewId: Id,
    commitTokenHash: Uint8Array,
  ): Promise<readonly PreviewRow[]>;
  commitPreview(input: ImportCommitDatabaseInput): Promise<ImportCommitResult>;
  consumeCredentialArtifact(
    ownerUserId: Id,
    artifactId: Id,
    actorUserId: Id,
    requestId: string,
  ): Promise<CredentialArtifactPayloadRecord>;
}

type CommitPreviewDb = Record<string, unknown> & {
  id: unknown;
  owner_user_id: unknown;
  status: unknown;
  expires_at: unknown;
  blocking_count: unknown;
  commit_token_hash: unknown;
  commit_idempotency_hash: unknown;
  commit_result_json: unknown;
};

type CommitRowDb = Record<string, unknown> & {
  row_number: unknown;
  username: unknown;
  display_name: unknown;
  class_id: unknown;
  classification: unknown;
  blocking: unknown;
  error_json: unknown;
};

type ArtifactDb = Record<string, unknown> & {
  id: unknown;
  owner_user_id: unknown;
  encrypted_payload: unknown;
  expires_at: unknown;
  downloaded_at: unknown;
};

export class SqlUserImportCommitRepository
  implements UserImportCommitRepository
{
  constructor(private readonly database: ImportRepositoryDatabase) {}

  async getCommitRows(
    ownerUserId: Id,
    previewId: Id,
    commitTokenHash: Uint8Array,
  ): Promise<readonly PreviewRow[]> {
    const preview = await this.database.query<CommitPreviewDb>(
      "SELECT id, owner_user_id, status, expires_at, blocking_count, " +
        "commit_token_hash, commit_idempotency_hash, commit_result_json " +
        "FROM user_import_previews WHERE id = ? AND owner_user_id = ? LIMIT 1",
      [previewId, ownerUserId],
    );
    const current = preview[0];
    assertPreviewCanCommit(current);
    if (current && requiredString(current.status) === "COMMITTED") return [];
    if (!equalDigest(current?.commit_token_hash, commitTokenHash)) {
      throw new ImportPreviewNotFoundError();
    }
    const rows = await this.database.query<CommitRowDb>(
      "SELECT r.`row_number`, r.username, r.display_name, r.class_id, " +
        "r.classification, r.blocking, r.error_json " +
        "FROM user_import_preview_rows r WHERE r.preview_id = ? " +
        "ORDER BY r.`row_number` ASC",
      [previewId],
    );
    return rows.map(mapCommitRow);
  }

  async commitPreview(
    input: ImportCommitDatabaseInput,
  ): Promise<ImportCommitResult> {
    try {
      return await this.database.transaction(async (connection) => {
        const previewRows = await connection.query<CommitPreviewDb>(
          "SELECT id, owner_user_id, status, expires_at, blocking_count, " +
            "commit_token_hash, commit_idempotency_hash, commit_result_json " +
            "FROM user_import_previews WHERE id = ? AND owner_user_id = ? " +
            "LIMIT 1 FOR UPDATE",
          [input.previewId, input.ownerUserId],
        );
        const preview = previewRows[0];
        if (!preview) throw new ImportPreviewNotFoundError();
        const status = requiredString(preview.status);
        if (status === "COMMITTED") {
          if (
            equalDigest(preview.commit_idempotency_hash, input.idempotencyHash)
          ) {
            return parseCommitResult(preview.commit_result_json);
          }
          throw new ImportPreviewAlreadyCommittedError();
        }
        assertPendingPreview(preview);
        if (!equalDigest(preview.commit_token_hash, input.commitTokenHash)) {
          throw new ImportPreviewNotFoundError();
        }

        const rows = await connection.query<CommitRowDb>(
          "SELECT r.`row_number`, r.username, r.display_name, r.class_id, " +
            "r.classification, r.blocking, r.error_json " +
            "FROM user_import_preview_rows r WHERE r.preview_id = ? " +
            "ORDER BY r.`row_number` ASC FOR UPDATE",
          [input.previewId],
        );
        const createRows = rows
          .map(mapCommitRow)
          .filter((row) => row.classification === "CREATE");
        validatePreparedCredentials(createRows, input.credentials);
        await validateClasses(connection, input.previewId, input.credentials);

        const createdUsers: Array<{ id: Id; classId: Id | null }> = [];
        for (const credential of input.credentials) {
          await connection.execute(
            "INSERT INTO users " +
              "(username, username_normalized, password_hash, role, status, " +
              "display_name, force_password_change) " +
              "VALUES (?, ?, ?, 'PARTICIPANT', 'ACTIVE', ?, TRUE)",
            [
              credential.username,
              credential.usernameNormalized,
              credential.passwordHash,
              credential.displayName,
            ],
          );
          const created = await connection.query<{ id: unknown }>(
            "SELECT id FROM users WHERE username_normalized = ? LIMIT 1",
            [credential.usernameNormalized],
          );
          if (!created[0]) {
            throw new Error("Created participant could not be read back");
          }
          createdUsers.push({
            id: requiredId(created[0].id),
            classId: credential.classId,
          });
        }
        await insertMemberships(connection, createdUsers, input.previewId);

        await connection.execute(
          "INSERT INTO user_import_credential_artifacts " +
            "(preview_id, owner_user_id, encrypted_payload, expires_at) " +
            "VALUES (?, ?, ?, ?)",
          [
            input.previewId,
            input.ownerUserId,
            input.artifactPayload,
            toDatabaseTimestamp(input.artifactExpiresAt),
          ],
        );
        const artifactRows = await connection.query<{ id: unknown }>(
          "SELECT id FROM user_import_credential_artifacts " +
            "WHERE preview_id = ? LIMIT 1",
          [input.previewId],
        );
        if (!artifactRows[0]) {
          throw new Error("Credential artifact was not created");
        }
        const artifactId = requiredId(artifactRows[0].id);

        await connection.execute(
          "UPDATE user_import_previews SET status = 'COMMITTED', " +
            "committed_at = UTC_TIMESTAMP(6), commit_idempotency_hash = ?, " +
            "committed_by_user_id = ?, commit_token_hash = NULL, " +
            "updated_at = UTC_TIMESTAMP(6) WHERE id = ?",
          [input.idempotencyHash, input.committedByUserId, input.previewId],
        );
        const committedRows = await connection.query<{
          committed_at: unknown;
        }>("SELECT committed_at FROM user_import_previews WHERE id = ?", [
          input.previewId,
        ]);
        if (!committedRows[0]) {
          throw new Error("Committed preview could not be read back");
        }
        const committedAt = requiredTimestamp(committedRows[0].committed_at);
        const result: ImportCommitResult = {
          previewId: input.previewId,
          artifactId,
          createdUserCount: createdUsers.length,
          committedAt,
        };
        await connection.execute(
          "UPDATE user_import_previews SET commit_result_json = ? WHERE id = ?",
          [JSON.stringify(result), input.previewId],
        );
        await insertAudit(connection, {
          actorUserId: input.committedByUserId,
          action: "IMPORT_COMMIT",
          entityType: "USER_IMPORT_PREVIEW",
          entityId: input.previewId,
          requestId: input.requestId,
          metadata: { artifactId, createdUserCount: createdUsers.length },
        });
        return result;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ImportPreviewCommitConflictError(
          "Participant username conflicts with an account created after preview",
        );
      }
      throw error;
    }
  }

  async consumeCredentialArtifact(
    ownerUserId: Id,
    artifactId: Id,
    actorUserId: Id,
    requestId: string,
  ): Promise<CredentialArtifactPayloadRecord> {
    return this.database.transaction(async (connection) => {
      const rows = await connection.query<ArtifactDb>(
        "SELECT id, owner_user_id, encrypted_payload, expires_at, downloaded_at " +
          "FROM user_import_credential_artifacts " +
          "WHERE id = ? AND owner_user_id = ? LIMIT 1 FOR UPDATE",
        [artifactId, ownerUserId],
      );
      const artifact = rows[0];
      if (!artifact) throw new CredentialArtifactNotFoundError();
      if (
        artifact.downloaded_at !== null &&
        artifact.downloaded_at !== undefined
      ) {
        throw new CredentialArtifactExpiredError();
      }
      const expiresAt = requiredTimestamp(artifact.expires_at);
      if (Date.parse(expiresAt) <= Date.now()) {
        throw new CredentialArtifactExpiredError();
      }
      const encryptedPayload = toBytes(artifact.encrypted_payload);
      await connection.execute(
        "UPDATE user_import_credential_artifacts " +
          "SET downloaded_at = UTC_TIMESTAMP(6) " +
          "WHERE id = ? AND downloaded_at IS NULL",
        [artifactId],
      );
      await insertAudit(connection, {
        actorUserId,
        action: "IMPORT_CREDENTIAL_DOWNLOAD",
        entityType: "USER_IMPORT_CREDENTIAL_ARTIFACT",
        entityId: artifactId,
        requestId,
        metadata: { artifactId },
      });
      return { artifactId, ownerUserId, encryptedPayload, expiresAt };
    });
  }
}

function assertPreviewCanCommit(preview: CommitPreviewDb | undefined): void {
  if (!preview) throw new ImportPreviewNotFoundError();
  if (requiredString(preview.status) === "COMMITTED") return;
  assertPendingPreview(preview);
}

function assertPendingPreview(preview: CommitPreviewDb): void {
  if (requiredString(preview.status) !== "PENDING") {
    throw new ImportPreviewCommitConflictError(
      "Import preview is not available for commit",
    );
  }
  if (Date.parse(requiredTimestamp(preview.expires_at)) <= Date.now()) {
    throw new ImportPreviewExpiredError();
  }
  if (numberValue(preview.blocking_count) > 0) {
    throw new ImportPreviewBlockingError();
  }
}

async function validateClasses(
  connection: ImportRepositoryConnection,
  previewId: Id,
  credentials: readonly PreparedImportCredential[],
): Promise<void> {
  const classIds = [
    ...new Set(
      credentials.flatMap((item) => (item.classId ? [item.classId] : [])),
    ),
  ];
  if (!classIds.length) return;
  const rows = await connection.query<{ id: unknown }>(
    "SELECT c.id FROM classes c " +
      "JOIN user_import_previews p ON p.academic_year_id = c.academic_year_id " +
      "WHERE p.id = ? AND c.status = 'ACTIVE' AND c.id IN (" +
      marks(classIds.length) +
      ") FOR UPDATE",
    [previewId, ...classIds],
  );
  if (rows.length !== classIds.length) {
    throw new ImportPreviewCommitConflictError(
      "A class changed or was archived after preview",
    );
  }
}

async function insertMemberships(
  connection: ImportRepositoryConnection,
  users: readonly { id: Id; classId: Id | null }[],
  previewId: Id,
): Promise<void> {
  const memberships = users.filter(
    (user): user is { id: Id; classId: Id } => user.classId !== null,
  );
  if (!memberships.length) return;
  const ids = memberships.map((user) => user.id);
  const conflicts = await connection.query<{ participant_id: unknown }>(
    "SELECT cm.participant_id FROM class_members cm " +
      "JOIN classes c ON c.id = cm.class_id " +
      "JOIN user_import_previews p ON p.academic_year_id = c.academic_year_id " +
      "WHERE p.id = ? AND cm.left_at IS NULL AND cm.participant_id IN (" +
      marks(ids.length) +
      ") FOR UPDATE",
    [previewId, ...ids],
  );
  if (conflicts.length) {
    throw new ImportPreviewCommitConflictError(
      "A participant already has an active class membership",
    );
  }
  for (const membership of memberships) {
    await connection.execute(
      "INSERT INTO class_members (class_id, participant_id) VALUES (?, ?)",
      [membership.classId, membership.id],
    );
  }
}

function validatePreparedCredentials(
  rows: readonly PreviewRow[],
  credentials: readonly PreparedImportCredential[],
): void {
  if (rows.length !== credentials.length) {
    throw new ImportPreviewCommitConflictError(
      "Prepared credentials do not match the preview",
    );
  }
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const credential = credentials[index];
    if (
      !row ||
      !credential ||
      row.rowNumber !== credential.rowNumber ||
      row.classId !== credential.classId ||
      row.username !== credential.username ||
      row.displayName !== credential.displayName
    ) {
      throw new ImportPreviewCommitConflictError(
        "Prepared credentials do not match the preview",
      );
    }
  }
}

async function insertAudit(
  connection: ImportRepositoryConnection,
  input: {
    readonly actorUserId: Id;
    readonly action: string;
    readonly entityType: string;
    readonly entityId: Id;
    readonly requestId: string;
    readonly metadata: Record<string, unknown>;
  },
): Promise<void> {
  await connection.execute(
    "INSERT INTO audit_logs " +
      "(actor_user_id, actor_type, action, entity_type, entity_id, " +
      "request_id, metadata_json) VALUES (?, 'HUMAN', ?, ?, ?, ?, ?)",
    [
      input.actorUserId,
      input.action,
      input.entityType,
      input.entityId,
      input.requestId,
      JSON.stringify(input.metadata),
    ],
  );
}

function mapCommitRow(row: CommitRowDb): PreviewRow {
  let errors: PreviewRow["errors"] = [];
  if (typeof row.error_json === "string") {
    try {
      const parsed = JSON.parse(row.error_json) as unknown;
      if (Array.isArray(parsed)) errors = parsed as readonly ImportFieldError[];
    } catch {
      errors = [];
    }
  }
  return {
    rowNumber: numberValue(row.row_number),
    username: nullableString(row.username),
    displayName: nullableString(row.display_name),
    classCode: null,
    classId: nullableId(row.class_id),
    existingUserId: null,
    classification: requiredString(
      row.classification,
    ) as PreviewRow["classification"],
    blocking:
      row.blocking === true || row.blocking === 1 || row.blocking === "1",
    errors,
  };
}

function parseCommitResult(value: unknown): ImportCommitResult {
  try {
    const parsed = (
      typeof value === "string" ? JSON.parse(value) : value
    ) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") throw new Error("invalid");
    return {
      previewId: requiredId(parsed.previewId),
      artifactId: requiredId(parsed.artifactId),
      createdUserCount: numberValue(parsed.createdUserCount),
      committedAt: requiredTimestamp(parsed.committedAt),
    };
  } catch {
    throw new ImportPreviewCommitConflictError(
      "Stored commit result is invalid",
    );
  }
}

function equalDigest(value: unknown, expected: Uint8Array): boolean {
  const actual = toBytes(value);
  return (
    actual.length === expected.length &&
    actual.every((byte, index) => byte === expected[index])
  );
}

function requiredId(value: unknown): Id {
  if (typeof value === "bigint") return formatId(value);
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return formatId(BigInt(value));
  }
  const parsed = parseId(value);
  if (!parsed) {
    throw new ImportPreviewCommitConflictError(
      "Database returned an invalid ID",
    );
  }
  return parsed;
}

function nullableId(value: unknown): Id | null {
  return value === null || value === undefined ? null : requiredId(value);
}

function requiredString(value: unknown): string {
  if (typeof value !== "string") {
    throw new ImportPreviewCommitConflictError(
      "Database returned an invalid string",
    );
  }
  return value;
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : requiredString(value);
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ImportPreviewCommitConflictError(
      "Database returned an invalid count",
    );
  }
  return parsed;
}

function requiredTimestamp(value: unknown): UtcTimestamp {
  if (value instanceof Date) return formatUtcTimestamp(value);
  if (typeof value === "string") {
    const normalized = value.endsWith("Z")
      ? value
      : `${value.replace(" ", "T")}Z`;
    const timestamp = parseUtcTimestamp(normalized);
    if (timestamp) return timestamp;
  }
  throw new ImportPreviewCommitConflictError(
    "Database returned an invalid timestamp",
  );
}

function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (typeof value === "string") {
    return new Uint8Array(Buffer.from(value, "binary"));
  }
  throw new ImportPreviewCommitConflictError(
    "Database returned invalid binary data",
  );
}

function marks(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: unknown; errno?: unknown } | null;
  const code = String(candidate?.code ?? candidate?.errno ?? "");
  return code === "ER_DUP_ENTRY" || code === "1062";
}

function toDatabaseTimestamp(value: UtcTimestamp): string {
  return value.endsWith("Z")
    ? value.slice(0, -1).replace("T", " ")
    : value.replace("T", " ");
}
