import {
  formatId,
  formatUtcTimestamp,
  type Id,
  normalizePageLimit,
  parseId,
  parseUtcTimestamp,
  type UtcTimestamp,
} from "@gezycbt/contracts";
import {
  type CreatePreviewRecord,
  decodeCursor,
  type ImportClassification,
  type ImportPreview,
  type ImportResolution,
  type ImportRowPage,
  type ImportRowPageRequest,
  ImportValidationError,
  type PreviewRow,
  type ResolvedClass,
  type ResolvedParticipantUser,
} from "./domain";

export interface ImportRepositoryConnection {
  query<T extends Record<string, unknown>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<readonly T[]>;
  execute(sql: string, parameters?: readonly unknown[]): Promise<unknown>;
}

export interface ImportRepositoryDatabase extends ImportRepositoryConnection {
  transaction<T>(
    operation: (connection: ImportRepositoryConnection) => Promise<T>,
  ): Promise<T>;
}

export interface UserImportRepository {
  resolveParticipants(
    academicYearId: Id,
    usernamesNormalized: readonly string[],
    classCodes: readonly string[],
  ): Promise<ImportResolution>;
  createPreview(input: CreatePreviewRecord): Promise<ImportPreview>;
  getPreview(ownerUserId: Id, previewId: Id): Promise<ImportPreview | null>;
  listRows(
    ownerUserId: Id,
    previewId: Id,
    request: ImportRowPageRequest,
  ): Promise<ImportRowPage>;
  listErrorRows(ownerUserId: Id, previewId: Id): Promise<readonly PreviewRow[]>;
}

type PreviewRowDb = Record<string, unknown> & {
  id: unknown;
  preview_id: unknown;
  row_number: unknown;
  username: unknown;
  display_name: unknown;
  class_code: unknown;
  class_id: unknown;
  existing_user_id: unknown;
  classification: unknown;
  blocking: unknown;
  error_json: unknown;
};

type PreviewDb = Record<string, unknown> & {
  id: unknown;
  owner_user_id: unknown;
  academic_year_id: unknown;
  mode: unknown;
  source_sha256: unknown;
  status: unknown;
  expires_at: unknown;
  committed_at: unknown;
  created_at: unknown;
  updated_at: unknown;
  total_rows: unknown;
  create_count: unknown;
  update_count: unknown;
  unchanged_count: unknown;
  duplicate_count: unknown;
  error_count: unknown;
  blocking_count: unknown;
};

const PREVIEW_COLUMNS = `
  SELECT p.id, p.owner_user_id, p.academic_year_id, p.mode, p.source_sha256,
         p.status, p.expires_at, p.committed_at, p.created_at, p.updated_at,
         p.total_rows, p.create_count, p.update_count, p.unchanged_count,
         p.duplicate_count, p.error_count, p.blocking_count
  FROM user_import_previews p`;
const ROW_COLUMNS = `
  SELECT r.id, r.preview_id, r.\`row_number\` AS row_number, r.username, r.display_name,
         r.class_code, r.class_id, r.existing_user_id, r.classification,
         r.blocking, r.error_json
  FROM user_import_preview_rows r`;

export class SqlUserImportRepository implements UserImportRepository {
  constructor(private readonly database: ImportRepositoryDatabase) {}

  async resolveParticipants(
    academicYearId: Id,
    usernamesNormalized: readonly string[],
    classCodes: readonly string[],
  ): Promise<ImportResolution> {
    const users = usernamesNormalized.length
      ? await this.database.query<{
          id: unknown;
          username_normalized: unknown;
          display_name: unknown;
          role: unknown;
          status: unknown;
        }>(
          `SELECT id, username_normalized, display_name, role, status
           FROM users WHERE username_normalized IN (${marks(usernamesNormalized.length)})`,
          usernamesNormalized,
        )
      : [];
    const classes = classCodes.length
      ? await this.database.query<{ id: unknown; code: unknown }>(
          `SELECT id, code FROM classes
           WHERE academic_year_id = ? AND status = 'ACTIVE'
             AND UPPER(code) IN (${marks(classCodes.length)})`,
          [academicYearId, ...classCodes],
        )
      : [];
    const userIds = users.map((row) => requiredId(row.id));
    const memberships = userIds.length
      ? await this.database.query<{
          participant_id: unknown;
          class_id: unknown;
        }>(
          `SELECT cm.participant_id, cm.class_id
           FROM class_members cm
           JOIN classes c ON c.id = cm.class_id
           WHERE c.academic_year_id = ? AND cm.left_at IS NULL
             AND cm.participant_id IN (${marks(userIds.length)})`,
          [academicYearId, ...userIds],
        )
      : [];
    const activeClassByParticipant = new Map(
      memberships.map((row) => [
        requiredId(row.participant_id),
        requiredId(row.class_id),
      ]),
    );
    return {
      users: users.map(
        (row): ResolvedParticipantUser => ({
          id: requiredId(row.id),
          usernameNormalized: requiredString(row.username_normalized),
          displayName: requiredString(row.display_name),
          role: requiredString(row.role),
          status: requiredString(row.status),
          activeClassId:
            activeClassByParticipant.get(requiredId(row.id)) ?? null,
        }),
      ),
      classes: classes.map(
        (row): ResolvedClass => ({
          id: requiredId(row.id),
          code: requiredString(row.code),
        }),
      ),
    };
  }

  async createPreview(input: CreatePreviewRecord): Promise<ImportPreview> {
    return this.database.transaction(async (connection) => {
      await connection.execute(
        `INSERT INTO user_import_previews
          (owner_user_id, academic_year_id, mode, source_sha256,
           commit_token_hash, status, total_rows, create_count, update_count,
           unchanged_count, duplicate_count, error_count, blocking_count, expires_at)
         VALUES (?, ?, 'CREATE_ONLY', ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.ownerUserId,
          input.academicYearId,
          input.sourceSha256,
          input.commitTokenHash,
          input.summary.totalRows,
          input.summary.createCount,
          input.summary.updateCount,
          input.summary.unchangedCount,
          input.summary.duplicateCount,
          input.summary.errorCount,
          input.summary.blockingCount,
          toDatabaseTimestamp(input.expiresAt),
        ],
      );
      const previewRows = await connection.query<{ id: unknown }>(
        `${PREVIEW_COLUMNS} WHERE p.commit_token_hash = ? LIMIT 1`,
        [input.commitTokenHash],
      );
      const previewId = previewRows[0] ? requiredId(previewRows[0].id) : null;
      if (!previewId)
        throw new Error("Created import preview could not be read back");
      if (input.rows.length) {
        const values = input.rows
          .map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .join(", ");
        const parameters: unknown[] = [];
        for (const row of input.rows) {
          parameters.push(
            previewId,
            row.rowNumber,
            row.username,
            row.displayName,
            row.classCode,
            row.classId,
            row.existingUserId,
            row.classification,
            row.blocking,
            JSON.stringify(row.errors),
          );
        }
        await connection.execute(
          `INSERT INTO user_import_preview_rows
          (preview_id, \`row_number\`, username, display_name, class_code,
             class_id, existing_user_id, classification, blocking, error_json)
           VALUES ${values}`,
          parameters,
        );
      }
      const rows = await connection.query<PreviewDb>(
        `${PREVIEW_COLUMNS} WHERE p.commit_token_hash = ? LIMIT 1`,
        [input.commitTokenHash],
      );
      if (!rows[0])
        throw new Error("Created import preview could not be read back");
      return mapPreview(rows[0]);
    });
  }

  async getPreview(
    ownerUserId: Id,
    previewId: Id,
  ): Promise<ImportPreview | null> {
    const rows = await this.database.query<PreviewDb>(
      `${PREVIEW_COLUMNS} WHERE p.id = ? AND p.owner_user_id = ? LIMIT 1`,
      [previewId, ownerUserId],
    );
    return rows[0] ? mapPreview(rows[0]) : null;
  }

  async listRows(
    ownerUserId: Id,
    previewId: Id,
    request: ImportRowPageRequest,
  ): Promise<ImportRowPage> {
    const limit = normalizePageLimit(request.limit);
    const cursor = decodeCursor(request.cursor);
    const conditions = ["r.preview_id = ?", "p.owner_user_id = ?"];
    const parameters: unknown[] = [previewId, ownerUserId];
    if (request.classification) {
      conditions.push("r.classification = ?");
      parameters.push(request.classification);
    }
    if (cursor) {
      conditions.push("r.`row_number` > ?");
      parameters.push(cursor);
    }
    parameters.push(limit + 1);
    const rows = await this.database.query<PreviewRowDb>(
      `${ROW_COLUMNS} JOIN user_import_previews p ON p.id = r.preview_id
       WHERE ${conditions.join(" AND ")} ORDER BY r.\`row_number\` ASC LIMIT ?`,
      parameters,
    );
    const items = rows.map(mapPreviewRow);
    const hasMore = items.length > limit;
    const visible = hasMore ? items.slice(0, limit) : items;
    return {
      items: visible,
      nextCursor: hasMore
        ? (visible.at(-1)?.rowNumber.toString() ?? null)
        : null,
    };
  }

  async listErrorRows(
    ownerUserId: Id,
    previewId: Id,
  ): Promise<readonly PreviewRow[]> {
    const rows = await this.database.query<PreviewRowDb>(
      `${ROW_COLUMNS} JOIN user_import_previews p ON p.id = r.preview_id
       WHERE r.preview_id = ? AND p.owner_user_id = ? AND r.blocking = TRUE
       ORDER BY r.\`row_number\` ASC`,
      [previewId, ownerUserId],
    );
    return rows.map(mapPreviewRow);
  }
}

function mapPreview(row: PreviewDb): ImportPreview {
  return {
    id: requiredId(row.id),
    ownerUserId: requiredId(row.owner_user_id),
    academicYearId: requiredId(row.academic_year_id),
    mode: "CREATE_ONLY",
    sourceSha256: toHex(row.source_sha256),
    status: requiredString(row.status) as ImportPreview["status"],
    expiresAt: requiredTimestamp(row.expires_at),
    committedAt: nullableTimestamp(row.committed_at),
    createdAt: requiredTimestamp(row.created_at),
    updatedAt: requiredTimestamp(row.updated_at),
    summary: {
      totalRows: numberValue(row.total_rows),
      createCount: numberValue(row.create_count),
      updateCount: numberValue(row.update_count),
      unchangedCount: numberValue(row.unchanged_count),
      duplicateCount: numberValue(row.duplicate_count),
      errorCount: numberValue(row.error_count),
      blockingCount: numberValue(row.blocking_count),
    },
  };
}

function mapPreviewRow(row: PreviewRowDb): PreviewRow {
  let errors: PreviewRow["errors"] = [];
  if (typeof row.error_json === "string") {
    try {
      const parsed = JSON.parse(row.error_json) as unknown;
      if (Array.isArray(parsed)) errors = parsed as PreviewRow["errors"];
    } catch {
      errors = [];
    }
  }
  return {
    rowNumber: numberValue(row.row_number),
    username: nullableString(row.username),
    displayName: nullableString(row.display_name),
    classCode: nullableString(row.class_code),
    classId: nullableId(row.class_id),
    existingUserId: nullableId(row.existing_user_id),
    classification: requiredString(row.classification) as ImportClassification,
    blocking:
      row.blocking === true || row.blocking === 1 || row.blocking === "1",
    errors,
  };
}

function marks(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

function requiredId(value: unknown): Id {
  if (typeof value === "bigint") return formatId(value);
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
    return formatId(BigInt(value));
  const parsed = parseId(value);
  if (!parsed)
    throw new ImportValidationError("Database returned an invalid ID");
  return parsed;
}

function nullableId(value: unknown): Id | null {
  return value === null || value === undefined ? null : requiredId(value);
}

function requiredString(value: unknown): string {
  if (typeof value !== "string")
    throw new ImportValidationError("Database returned an invalid string");
  return value;
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : requiredString(value);
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new ImportValidationError("Database returned an invalid count");
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
  throw new ImportValidationError("Database returned an invalid timestamp");
}

function nullableTimestamp(value: unknown): UtcTimestamp | null {
  return value === null || value === undefined
    ? null
    : requiredTimestamp(value);
}

function toHex(value: unknown): string {
  if (value instanceof Uint8Array)
    return [...value]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  if (typeof value === "string") return value;
  return "";
}

function toDatabaseTimestamp(value: UtcTimestamp): string {
  return value.endsWith("Z")
    ? value.slice(0, -1).replace("T", " ")
    : value.replace("T", " ");
}
