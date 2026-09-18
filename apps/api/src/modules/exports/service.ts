import {
  formatUtcTimestamp,
  type Id,
  parseUtcTimestamp,
  type UtcTimestamp,
} from "@gezycbt/contracts";
import type { DatabaseConnection, DatabasePort } from "@gezycbt/database";
import type { FilesystemDiskGuard } from "../../observability/disk-guard";

export const EXPORT_FORMATS = ["CSV", "JSON"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const EXPORT_STATUSES = [
  "QUEUED",
  "RUNNING",
  "READY",
  "FAILED",
  "EXPIRED",
] as const;
export type ExportStatus = (typeof EXPORT_STATUSES)[number];

export const EXPORT_COLUMNS = [
  "id",
  "sessionId",
  "participantId",
  "participantName",
  "username",
  "class",
  "institution",
  "correctCount",
  "incorrectCount",
  "unansweredCount",
  "earnedScore",
  "maxScore",
  "percentage",
  "releasedAt",
  "scoredAt",
] as const;
export type ExportColumn = (typeof EXPORT_COLUMNS)[number];

export const EXPORT_PII_COLUMNS = new Set<ExportColumn>([
  "participantId",
  "username",
  "class",
  "institution",
]);

const DEFAULT_EXPORT_COLUMNS: readonly ExportColumn[] = [
  "id",
  "sessionId",
  "participantName",
  "correctCount",
  "incorrectCount",
  "unansweredCount",
  "earnedScore",
  "maxScore",
  "percentage",
  "releasedAt",
  "scoredAt",
];

export interface ExportFilter {
  readonly release?: "RELEASED" | "UNRELEASED";
}

export interface CreateExportJobInput {
  readonly requesterUserId: Id;
  readonly scheduleId: Id;
  readonly format: ExportFormat;
  readonly includePii: boolean;
  readonly integrationClientId?: Id | null;
  readonly integrationGrantVersion?: number | null;
  readonly scopeSnapshot?: Readonly<Record<string, unknown>> | null;
  readonly filter?: ExportFilter;
  readonly columns?: readonly ExportColumn[];
  readonly rowLimit?: number;
}

export interface ExportJobView {
  readonly id: Id;
  readonly scheduleId: Id;
  readonly format: ExportFormat;
  readonly status: ExportStatus;
  readonly includePii: boolean;
  readonly rowCount: number | null;
  readonly errorMessage: string | null;
  readonly createdAt: UtcTimestamp;
  readonly expiresAt: UtcTimestamp;
}

export interface ExportJobRecord extends ExportJobView {
  readonly requesterUserId: Id;
  readonly integrationClientId: Id | null;
  readonly integrationGrantVersion: number | null;
  readonly scopeSnapshot: Readonly<Record<string, unknown>> | null;
  readonly filter: ExportFilter;
  readonly columns: readonly ExportColumn[];
  readonly rowLimit: number;
}

export interface ExportDownload {
  readonly body: Uint8Array;
  readonly format: ExportFormat;
  readonly jobId: Id;
}

export class ExportNotFoundError extends Error {
  constructor() {
    super("Export job was not found");
    this.name = "ExportNotFoundError";
  }
}

export class ExportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportValidationError";
  }
}

export class ExportActiveError extends Error {
  constructor() {
    super("An export job is already active for this requester");
    this.name = "ExportActiveError";
  }
}

export class ExportNotReadyError extends Error {
  constructor() {
    super("Export is not ready for download");
    this.name = "ExportNotReadyError";
  }
}

export class ExportDownloadTokenError extends Error {
  constructor() {
    super("Download token is invalid, expired, or already used");
    this.name = "ExportDownloadTokenError";
  }
}

export class ExportIdempotencyConflictError extends Error {
  constructor() {
    super("Idempotency key conflicts with a different export request");
    this.name = "ExportIdempotencyConflictError";
  }
}

export class ExportIdempotencyInProgressError extends Error {
  constructor() {
    super("The export request is still being processed");
    this.name = "ExportIdempotencyInProgressError";
  }
}

interface ExportJobRow extends Record<string, unknown> {}

/** Shared bounded export job and worker used by staff web and agent routes. */
export class ExportService {
  private readonly pending: Id[] = [];
  private processing = false;

  constructor(
    private readonly database: DatabasePort,
    private readonly diskGuard?: Pick<FilesystemDiskGuard, "assertAvailable">,
  ) {}

  async createJob(input: CreateExportJobInput): Promise<ExportJobView> {
    await this.diskGuard?.assertAvailable("export");
    const normalized = normalizeCreateInput(input);
    const result = await this.database.transaction(async (connection) => {
      await this.lockRequester(connection, normalized);
      await this.assertNoActiveJob(connection, normalized);
      const inserted = await connection.execute(
        `INSERT INTO export_jobs
          (requester_user_id, integration_client_id, integration_grant_version,
           schedule_id, format, include_pii, scope_snapshot_json, filter_json,
           columns_json, row_limit, status, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'QUEUED', DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 1 HOUR))`,
        [
          normalized.requesterUserId,
          normalized.integrationClientId,
          normalized.integrationGrantVersion,
          normalized.scheduleId,
          normalized.format,
          normalized.includePii ? 1 : 0,
          normalized.scopeSnapshot
            ? JSON.stringify(normalized.scopeSnapshot)
            : null,
          JSON.stringify(normalized.filter),
          JSON.stringify(normalized.columns),
          normalized.rowLimit,
        ],
      );
      if (inserted.insertId === undefined)
        throw new Error("Export job insert did not return an ID");
      const record = await this.readRecord(
        connection,
        String(inserted.insertId) as Id,
      );
      if (!record) throw new Error("Export job could not be read back");
      return record;
    });
    this.enqueue(result.id);
    return toView(result);
  }

  /** Agent creation includes durable replay protection in the same transaction. */
  async createAgentJob(
    input: CreateExportJobInput & { readonly idempotencyKey: string },
  ): Promise<ExportJobView> {
    if (!input.integrationClientId)
      throw new ExportValidationError("Integration client is required");
    await this.diskGuard?.assertAvailable("export");
    const normalized = normalizeCreateInput(input);
    const requestHash = await sha256Bytes(
      JSON.stringify({
        scheduleId: normalized.scheduleId,
        format: normalized.format,
        includePii: normalized.includePii,
        filter: normalized.filter,
        columns: normalized.columns,
        rowLimit: normalized.rowLimit,
        scopeSnapshot: normalized.scopeSnapshot,
      }),
    );
    const result = await this.database.transaction(async (connection) => {
      const existingRows = await connection.query<ExportJobRow>(
        `SELECT id, request_hash, status, response_json, expires_at
         FROM integration_idempotency_keys
         WHERE integration_client_id = ? AND idempotency_key = ? LIMIT 1 FOR UPDATE`,
        [normalized.integrationClientId, input.idempotencyKey],
      );
      const existing = existingRows[0];
      if (existing) {
        if (existing.expires_at && !isFuture(existing.expires_at)) {
          await connection.execute(
            "DELETE FROM integration_idempotency_keys WHERE id = ?",
            [existing.id],
          );
        } else {
          if (!bytesEqual(existing.request_hash, requestHash))
            throw new ExportIdempotencyConflictError();
          if (String(existing.status) === "COMPLETED") {
            const replay = parseStoredView(existing.response_json);
            if (replay) return { record: replay, created: false };
          }
          throw new ExportIdempotencyInProgressError();
        }
      }
      await connection.execute(
        `INSERT INTO integration_idempotency_keys
          (integration_client_id, idempotency_key, request_hash, status, expires_at)
         VALUES (?, ?, ?, 'PROCESSING', DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 1 DAY))`,
        [normalized.integrationClientId, input.idempotencyKey, requestHash],
      );
      await this.lockRequester(connection, normalized);
      await this.assertNoActiveJob(connection, normalized);
      const inserted = await connection.execute(
        `INSERT INTO export_jobs
          (requester_user_id, integration_client_id, integration_grant_version,
           schedule_id, format, include_pii, scope_snapshot_json, filter_json,
           columns_json, row_limit, status, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'QUEUED', DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 1 HOUR))`,
        [
          normalized.requesterUserId,
          normalized.integrationClientId,
          normalized.integrationGrantVersion,
          normalized.scheduleId,
          normalized.format,
          normalized.includePii ? 1 : 0,
          normalized.scopeSnapshot
            ? JSON.stringify(normalized.scopeSnapshot)
            : null,
          JSON.stringify(normalized.filter),
          JSON.stringify(normalized.columns),
          normalized.rowLimit,
        ],
      );
      if (inserted.insertId === undefined)
        throw new Error("Export job insert did not return an ID");
      const record = await this.readRecord(
        connection,
        String(inserted.insertId) as Id,
      );
      if (!record) throw new Error("Export job could not be read back");
      const view = toView(record);
      await connection.execute(
        `UPDATE integration_idempotency_keys
         SET status = 'COMPLETED', response_json = ?, completed_at = UTC_TIMESTAMP(6)
         WHERE integration_client_id = ? AND idempotency_key = ?`,
        [
          JSON.stringify(view),
          normalized.integrationClientId,
          input.idempotencyKey,
        ],
      );
      return { record, created: true };
    });
    if (result.created) this.enqueue(result.record.id);
    return toView(result.record);
  }

  /** Recover queued work after a process restart and execute a bounded batch. */
  async runWorkerOnce(limit = 1): Promise<readonly Id[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10)
      throw new ExportValidationError("Worker limit must be between 1 and 10");
    await this.database.execute(
      `UPDATE export_jobs SET status = 'QUEUED', updated_at = UTC_TIMESTAMP(6)
       WHERE status = 'RUNNING'
         AND updated_at <= DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 10 MINUTE)
         AND expires_at > UTC_TIMESTAMP(6)`,
    );
    const rows = await this.database.query<{ id: unknown }>(
      `SELECT id FROM export_jobs
       WHERE status = 'QUEUED' AND expires_at > UTC_TIMESTAMP(6)
       ORDER BY id ASC LIMIT ?`,
      [limit],
    );
    const processed: Id[] = [];
    for (const row of rows) {
      const id = requiredId(row.id);
      await this.processJob(id);
      processed.push(id);
    }
    await this.database.execute(
      `UPDATE export_jobs SET status = 'EXPIRED', updated_at = UTC_TIMESTAMP(6)
       WHERE status IN ('QUEUED', 'RUNNING') AND expires_at <= UTC_TIMESTAMP(6)`,
    );
    return processed;
  }

  async listJobs(
    requesterUserId: Id,
    options: {
      readonly scheduleId?: Id;
      readonly cursor?: Id;
      readonly limit: number;
      readonly integrationClientId?: Id | null;
    },
  ): Promise<{
    readonly items: readonly ExportJobView[];
    readonly nextCursor: Id | null;
  }> {
    const limit = boundedLimit(options.limit);
    const conditions = ["requester_user_id = ?"];
    const parameters: unknown[] = [requesterUserId];
    if (options.integrationClientId !== undefined) {
      conditions.push(
        options.integrationClientId === null
          ? "integration_client_id IS NULL"
          : "integration_client_id = ?",
      );
      if (options.integrationClientId !== null)
        parameters.push(options.integrationClientId);
    }
    if (options.scheduleId) {
      conditions.push("schedule_id = ?");
      parameters.push(options.scheduleId);
    }
    if (options.cursor) {
      conditions.push("id < ?");
      parameters.push(options.cursor);
    }
    parameters.push(limit + 1);
    const rows = await this.database.query<ExportJobRow>(
      `SELECT id, requester_user_id, integration_client_id,
              integration_grant_version, schedule_id, format, status,
              include_pii, row_count, error_message, created_at, expires_at,
              scope_snapshot_json, filter_json, columns_json, row_limit
       FROM export_jobs WHERE ${conditions.join(" AND ")}
       ORDER BY id DESC LIMIT ?`,
      parameters,
    );
    const records = rows.slice(0, limit).map(mapRecord);
    return {
      items: records.map(toView),
      nextCursor: rows.length > limit ? requiredId(rows[limit]?.id) : null,
    };
  }

  async getJob(jobId: Id): Promise<ExportJobRecord | null> {
    await this.expireJob(jobId);
    return this.readRecord(this.database, jobId);
  }

  async issueDownloadToken(
    jobId: Id,
  ): Promise<{ readonly token: string; readonly expiresAt: UtcTimestamp }> {
    const token = Buffer.from(
      crypto.getRandomValues(new Uint8Array(32)),
    ).toString("base64url");
    const digest = await sha256Bytes(token);
    const expiresAt = formatUtcTimestamp(new Date(Date.now() + 5 * 60_000));
    const result = await this.database.transaction(async (connection) => {
      const job = await this.readRecord(connection, jobId);
      if (!job || job.status !== "READY" || !isFuture(job.expiresAt))
        throw new ExportNotReadyError();
      const files = await connection.query<ExportJobRow>(
        "SELECT id FROM export_files WHERE export_job_id = ? LIMIT 1",
        [jobId],
      );
      if (!files[0]) throw new ExportNotReadyError();
      await connection.execute(
        "UPDATE export_files SET download_token_digest = ?, download_token_expires_at = ?, downloaded_at = NULL WHERE export_job_id = ?",
        [digest, toDatabaseDate(expiresAt), jobId],
      );
      return { token, expiresAt };
    });
    return result;
  }

  async consumeDownload(jobId: Id, token: string): Promise<ExportDownload> {
    const digest = await sha256Bytes(token);
    const result = await this.database.transaction(async (connection) => {
      const updated = await connection.execute(
        `UPDATE export_files f
         JOIN export_jobs j ON j.id = f.export_job_id
         SET f.downloaded_at = UTC_TIMESTAMP(6),
             f.download_token_digest = NULL,
             f.download_token_expires_at = NULL
         WHERE f.export_job_id = ? AND f.download_token_digest = ?
           AND f.download_token_expires_at > UTC_TIMESTAMP(6)
           AND f.downloaded_at IS NULL AND j.status = 'READY'
           AND j.expires_at > UTC_TIMESTAMP(6)`,
        [jobId, digest],
      );
      if (updated.affectedRows !== 1) throw new ExportDownloadTokenError();
      const rows = await connection.query<ExportJobRow>(
        `SELECT j.format, f.content_blob
         FROM export_files f JOIN export_jobs j ON j.id = f.export_job_id
         WHERE f.export_job_id = ? LIMIT 1`,
        [jobId],
      );
      const row = rows[0];
      if (!row) throw new ExportDownloadTokenError();
      return {
        body: toBytes(row.content_blob),
        format: parseFormat(row.format),
        jobId,
      };
    });
    return result;
  }

  private enqueue(jobId: Id): void {
    this.pending.push(jobId);
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.pending.length > 0) {
        const jobId = this.pending.shift();
        if (jobId) await this.processJob(jobId);
      }
    } finally {
      this.processing = false;
    }
  }

  private async processJob(jobId: Id): Promise<void> {
    const claimed = await this.database.execute(
      `UPDATE export_jobs SET status = 'RUNNING', updated_at = UTC_TIMESTAMP(6)
       WHERE id = ? AND status = 'QUEUED' AND expires_at > UTC_TIMESTAMP(6)`,
      [jobId],
    );
    if (claimed.affectedRows !== 1) {
      await this.database.execute(
        `UPDATE export_jobs SET status = 'EXPIRED', updated_at = UTC_TIMESTAMP(6)
         WHERE id = ? AND status = 'QUEUED' AND expires_at <= UTC_TIMESTAMP(6)`,
        [jobId],
      );
      return;
    }
    try {
      const record = await this.readRecord(this.database, jobId);
      if (!record) throw new Error("Export job disappeared");
      const where = ["r.schedule_id = ?"];
      const parameters: unknown[] = [record.scheduleId];
      if (record.filter.release === "RELEASED")
        where.push("r.released_at IS NOT NULL");
      if (record.filter.release === "UNRELEASED")
        where.push("r.released_at IS NULL");
      parameters.push(record.rowLimit);
      const rows = await this.database.query<ExportJobRow>(
        `SELECT r.id, r.session_id, r.participant_id,
                r.correct_count, r.incorrect_count, r.unanswered_count,
                r.earned_score, r.max_score, r.percentage, r.released_at,
                r.scored_at, s.participant_name_snapshot, s.class_snapshot,
                s.institution_snapshot, u.username
         FROM exam_results r
         JOIN exam_sessions s ON s.id = r.session_id
         LEFT JOIN users u ON u.id = r.participant_id
         WHERE ${where.join(" AND ")}
         ORDER BY r.id ASC LIMIT ?`,
        parameters,
      );
      const projected = rows.map((row) => projectRow(row, record));
      const content =
        record.format === "JSON"
          ? `${JSON.stringify(projected)}\n`
          : renderCsv(projected, record.columns);
      const digest = await sha256Bytes(content);
      await this.database.transaction(async (connection) => {
        await connection.execute(
          "INSERT INTO export_files (export_job_id, content_blob, content_sha256) VALUES (?, ?, ?)",
          [jobId, Buffer.from(content), digest],
        );
        await connection.execute(
          `UPDATE export_jobs SET status = 'READY', row_count = ?, updated_at = UTC_TIMESTAMP(6)
           WHERE id = ? AND status = 'RUNNING'`,
          [projected.length, jobId],
        );
      });
    } catch {
      await this.database.execute(
        `UPDATE export_jobs SET status = 'FAILED', error_message = 'Export gagal diproses.', updated_at = UTC_TIMESTAMP(6)
         WHERE id = ? AND status IN ('QUEUED', 'RUNNING')`,
        [jobId],
      );
    }
  }

  private async expireJob(jobId: Id): Promise<void> {
    await this.database.execute(
      `UPDATE export_jobs SET status = 'EXPIRED', updated_at = UTC_TIMESTAMP(6)
       WHERE id = ? AND status IN ('QUEUED', 'RUNNING', 'READY')
         AND expires_at <= UTC_TIMESTAMP(6)`,
      [jobId],
    );
  }

  private async lockRequester(
    connection: DatabaseConnection,
    input: NormalizedCreateInput,
  ): Promise<void> {
    if (input.integrationClientId) {
      await connection.query(
        "SELECT id FROM integration_clients WHERE id = ? FOR UPDATE",
        [input.integrationClientId],
      );
      return;
    }
    await connection.query("SELECT id FROM users WHERE id = ? FOR UPDATE", [
      input.requesterUserId,
    ]);
  }

  private async assertNoActiveJob(
    connection: DatabaseConnection,
    input: NormalizedCreateInput,
  ): Promise<void> {
    const condition = input.integrationClientId
      ? "integration_client_id = ?"
      : "integration_client_id IS NULL AND requester_user_id = ?";
    const rows = await connection.query(
      `SELECT id FROM export_jobs WHERE ${condition}
       AND status IN ('QUEUED', 'RUNNING') LIMIT 1`,
      [input.integrationClientId ?? input.requesterUserId],
    );
    if (rows[0]) throw new ExportActiveError();
  }

  private async readRecord(
    connection: DatabaseConnection,
    jobId: Id,
  ): Promise<ExportJobRecord | null> {
    const rows = await connection.query<ExportJobRow>(
      `SELECT id, requester_user_id, integration_client_id,
              integration_grant_version, schedule_id, format, status,
              include_pii, row_count, error_message, created_at, expires_at,
              scope_snapshot_json, filter_json, columns_json, row_limit
       FROM export_jobs WHERE id = ? LIMIT 1`,
      [jobId],
    );
    return rows[0] ? mapRecord(rows[0]) : null;
  }
}

interface NormalizedCreateInput {
  readonly requesterUserId: Id;
  readonly scheduleId: Id;
  readonly format: ExportFormat;
  readonly includePii: boolean;
  readonly integrationClientId: Id | null;
  readonly integrationGrantVersion: number | null;
  readonly scopeSnapshot: Readonly<Record<string, unknown>> | null;
  readonly filter: ExportFilter;
  readonly columns: readonly ExportColumn[];
  readonly rowLimit: number;
}

function normalizeCreateInput(
  input: CreateExportJobInput,
): NormalizedCreateInput {
  const format = parseFormat(input.format);
  if (typeof input.includePii !== "boolean")
    throw new ExportValidationError("includePii must be boolean");
  const filter = normalizeFilter(input.filter);
  const columns = normalizeColumns(input.columns, input.includePii);
  const rowLimit = input.rowLimit ?? 10_000;
  if (!Number.isSafeInteger(rowLimit) || rowLimit < 1 || rowLimit > 100_000)
    throw new ExportValidationError("rowLimit must be between 1 and 100000");
  return {
    requesterUserId: requiredId(input.requesterUserId),
    scheduleId: requiredId(input.scheduleId),
    format,
    includePii: input.includePii,
    integrationClientId:
      input.integrationClientId === null ||
      input.integrationClientId === undefined
        ? null
        : requiredId(input.integrationClientId),
    integrationGrantVersion:
      input.integrationGrantVersion === null ||
      input.integrationGrantVersion === undefined
        ? null
        : integer(input.integrationGrantVersion),
    scopeSnapshot: input.scopeSnapshot ?? null,
    filter,
    columns,
    rowLimit,
  };
}

function normalizeFilter(value: ExportFilter | undefined): ExportFilter {
  if (!value) return {};
  const release = value.release;
  if (release !== "RELEASED" && release !== "UNRELEASED")
    throw new ExportValidationError("Invalid release filter");
  return { release };
}

function normalizeColumns(
  value: readonly ExportColumn[] | undefined,
  includePii: boolean,
): readonly ExportColumn[] {
  const columns = value
    ? [...new Set(value)]
    : includePii
      ? [
          ...DEFAULT_EXPORT_COLUMNS.slice(0, 3),
          "username" as const,
          ...DEFAULT_EXPORT_COLUMNS.slice(3),
        ]
      : DEFAULT_EXPORT_COLUMNS;
  if (columns.length === 0)
    throw new ExportValidationError("At least one column is required");
  if (columns.some((column) => !EXPORT_COLUMNS.includes(column)))
    throw new ExportValidationError("Export column is not supported");
  if (!includePii && columns.some((column) => EXPORT_PII_COLUMNS.has(column)))
    throw new ExportValidationError(
      "PII columns require an explicit PII grant",
    );
  return columns;
}

function projectRow(
  row: ExportJobRow,
  record: ExportJobRecord,
): Record<string, unknown> {
  const all: Record<string, unknown> = {
    id: String(row.id),
    sessionId: String(row.session_id),
    participantId:
      row.participant_id == null ? null : String(row.participant_id),
    participantName: String(row.participant_name_snapshot ?? ""),
    username: row.username == null ? null : String(row.username),
    class: row.class_snapshot == null ? null : String(row.class_snapshot),
    institution:
      row.institution_snapshot == null
        ? null
        : String(row.institution_snapshot),
    correctCount: toNumber(row.correct_count),
    incorrectCount: toNumber(row.incorrect_count),
    unansweredCount: toNumber(row.unanswered_count),
    earnedScore: String(row.earned_score),
    maxScore: String(row.max_score),
    percentage: String(row.percentage),
    releasedAt: row.released_at == null ? null : isoValue(row.released_at),
    scoredAt: isoValue(row.scored_at),
  };
  return Object.fromEntries(
    record.columns.map((column) => [column, all[column]]),
  );
}

function renderCsv(
  rows: readonly Record<string, unknown>[],
  columns: readonly ExportColumn[],
): string {
  const escapeCell = (value: unknown) => {
    const text = value == null ? "" : String(value);
    return /[",\n\r]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return `${columns.join(",")}\n${rows.map((row) => columns.map((column) => escapeCell(row[column])).join(",")).join("\n")}\n`;
}

function mapRecord(row: ExportJobRow): ExportJobRecord {
  const format = parseFormat(row.format);
  const status = String(row.status) as ExportStatus;
  if (!EXPORT_STATUSES.includes(status))
    throw new Error("Database returned invalid export status");
  const columns = parseColumns(row.columns_json, Boolean(row.include_pii));
  return {
    id: requiredId(row.id),
    requesterUserId: requiredId(row.requester_user_id),
    integrationClientId:
      row.integration_client_id == null
        ? null
        : requiredId(row.integration_client_id),
    integrationGrantVersion:
      row.integration_grant_version == null
        ? null
        : integer(row.integration_grant_version),
    scheduleId: requiredId(row.schedule_id),
    format,
    status,
    includePii: databaseBoolean(row.include_pii),
    rowCount: row.row_count == null ? null : toNumber(row.row_count),
    errorMessage: row.error_message == null ? null : String(row.error_message),
    createdAt: isoValue(row.created_at),
    expiresAt: isoValue(row.expires_at),
    scopeSnapshot: parseObject(row.scope_snapshot_json),
    filter: parseFilter(row.filter_json),
    columns,
    rowLimit: toNumber(row.row_limit) || 10_000,
  };
}

function toView(record: ExportJobRecord): ExportJobView {
  return {
    id: record.id,
    scheduleId: record.scheduleId,
    format: record.format,
    status: record.status,
    includePii: record.includePii,
    rowCount: record.rowCount,
    errorMessage: record.errorMessage,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
  };
}

export function exportJobView(record: ExportJobRecord): ExportJobView {
  return toView(record);
}

function parseStoredView(value: unknown): ExportJobRecord | null {
  if (!value) return null;
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return null;
    const view = parsed as Record<string, unknown>;
    const id = requiredId(view.id);
    const scheduleId = requiredId(view.scheduleId);
    const format = parseFormat(view.format);
    const status = String(view.status) as ExportStatus;
    if (
      status !== "QUEUED" &&
      status !== "RUNNING" &&
      status !== "READY" &&
      status !== "FAILED" &&
      status !== "EXPIRED"
    )
      return null;
    const createdAt = isoValue(view.createdAt);
    const expiresAt = isoValue(view.expiresAt);
    return {
      id,
      scheduleId,
      format,
      status,
      includePii: Boolean(view.includePii),
      rowCount: view.rowCount == null ? null : toNumber(view.rowCount),
      errorMessage:
        view.errorMessage == null ? null : String(view.errorMessage),
      createdAt,
      expiresAt,
      requesterUserId: "0" as Id,
      integrationClientId: null,
      integrationGrantVersion: null,
      scopeSnapshot: null,
      filter: {},
      columns: normalizeColumns(undefined, Boolean(view.includePii)),
      rowLimit: 10_000,
    };
  } catch {
    return null;
  }
}

function parseColumns(
  value: unknown,
  includePii: boolean,
): readonly ExportColumn[] {
  if (value === null || value === undefined || value === "")
    return normalizeColumns(undefined, includePii);
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(parsed))
    throw new Error("Database returned invalid export columns");
  return normalizeColumns(parsed as ExportColumn[], includePii);
}

function parseFilter(value: unknown): ExportFilter {
  if (value === null || value === undefined || value === "") return {};
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const release = (parsed as Record<string, unknown>).release;
  return release === "RELEASED" || release === "UNRELEASED" ? { release } : {};
}

function parseObject(value: unknown): Readonly<Record<string, unknown>> | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Readonly<Record<string, unknown>>)
    : null;
}

function parseFormat(value: unknown): ExportFormat {
  if (value === "CSV" || value === "JSON") return value;
  throw new Error("Database returned invalid export format");
}

function requiredId(value: unknown): Id {
  const candidate = String(value ?? "");
  if (!/^\d+$/u.test(candidate))
    throw new Error("Database returned invalid ID");
  return candidate as Id;
}

function integer(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new ExportValidationError("Integer value is invalid");
  return parsed;
}

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function databaseBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === 1n || value === "1";
}

function isoValue(value: unknown): UtcTimestamp {
  const raw = value instanceof Date ? value.toISOString() : String(value ?? "");
  const normalized =
    value instanceof Date
      ? raw
      : raw.endsWith("Z")
        ? raw
        : `${raw.replace(" ", "T")}Z`;
  const parsed = parseUtcTimestamp(normalized);
  if (!parsed) throw new Error("Database returned invalid timestamp");
  return parsed;
}

function toDatabaseDate(timestamp: UtcTimestamp): string {
  return timestamp.replace("T", " ").replace("Z", "");
}

function isFuture(value: unknown): boolean {
  const timestamp =
    value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(timestamp) && timestamp > Date.now();
}

async function sha256Bytes(value: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}

function bytesEqual(left: unknown, right: Uint8Array): boolean {
  const bytes = toBytes(left);
  if (bytes.length !== right.length) return false;
  return bytes.every((value, index) => value === right[index]);
}

function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof value === "string")
    return new Uint8Array(Buffer.from(value, "binary"));
  if (Array.isArray(value)) return new Uint8Array(value as number[]);
  throw new Error("Database returned invalid binary payload");
}

function boundedLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100)
    throw new ExportValidationError("Limit must be between 1 and 100");
  return value;
}
