import {
  formatId,
  formatUtcTimestamp,
  type Id,
  parseId,
  parseUtcTimestamp,
  type UtcTimestamp,
} from "@gezycbt/contracts";
import type {
  DatabaseConnection,
  DatabasePort,
  DatabaseResult,
} from "@gezycbt/database";
import { ScheduleAccessCodeConflictError } from "./access-code";
import {
  type NormalizedCreateScheduleInput,
  type NormalizedUpdateScheduleInput,
  type ResultReleasePolicy,
  SCHEDULE_STATUSES,
  type Schedule,
  type ScheduleExamReference,
  type ScheduleIdentityField,
  ScheduleImmutableError,
  type ScheduleStatus,
  type ScheduleTransition,
  ScheduleTransitionError,
  ScheduleValidationError,
  ScheduleVersionConflictError,
} from "./domain";
import type { ScheduleLifecycleCandidateRepository } from "./reconciler";

export interface ScheduleRepository {
  findSchedule(id: Id): Promise<Schedule | null>;
  findExamRevision(id: Id): Promise<ScheduleExamReference | null>;
  createSchedule(input: NormalizedCreateScheduleInput): Promise<Schedule>;
  updateSchedule(
    id: Id,
    input: NormalizedUpdateScheduleInput,
    expectedUpdatedAt: UtcTimestamp,
  ): Promise<Schedule | null>;
  deleteSchedule(id: Id, expectedUpdatedAt: UtcTimestamp): Promise<boolean>;
  transitionSchedule(
    id: Id,
    targetStatus: ScheduleTransition,
    expectedUpdatedAt: UtcTimestamp,
    options?: ScheduleTransitionOptions,
  ): Promise<Schedule | null>;
}

export type ScheduleAccessField = "PRACTICE_TOKEN" | "MAIN_ACCESS_CODE";

export interface ScheduleAccessRepository {
  updateAccessCode(
    id: Id,
    field: ScheduleAccessField,
    digest: Uint8Array,
    hint: string,
    expectedUpdatedAt: UtcTimestamp,
  ): Promise<Schedule | null>;
}

export interface ScheduleTransitionOptions {
  readonly closedByUserId?: Id | null;
  readonly closeReason?: string | null;
}

export interface ScheduleRepositoryConnection extends DatabaseConnection {}

export class SqlScheduleRepository
  implements ScheduleRepository, ScheduleLifecycleCandidateRepository
{
  constructor(private readonly database: DatabasePort) {}

  findSchedule(id: Id): Promise<Schedule | null> {
    return this.database.transaction((connection) =>
      readSchedule(connection, id),
    );
  }

  async findExamRevision(id: Id): Promise<ScheduleExamReference | null> {
    const rows = await this.database.query<ExamRevisionRow>(
      `SELECT er.id, er.exam_id, e.subject_id, e.owner_teacher_id,
              er.status AS revision_status, e.status AS exam_status
       FROM exam_revisions er
       JOIN exams e ON e.id = er.exam_id
       WHERE er.id = ? LIMIT 1`,
      [id],
    );
    return rows[0] ? mapExamReference(rows[0]) : null;
  }

  async listLifecycleCandidates(
    now: UtcTimestamp,
    limit: number,
  ): Promise<readonly { id: Id }[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new RangeError(
        "Lifecycle candidate limit must be between 1 and 100",
      );
    const timestamp = parseUtcTimestamp(now);
    if (!timestamp)
      throw new ScheduleValidationError(
        "Invalid lifecycle timestamp",
        "INVALID_TIMESTAMP",
      );
    const rows = await this.database.query<{ id: unknown }>(
      `SELECT id
       FROM exam_schedules
       WHERE (status = 'READY' AND starts_at <= ?)
          OR (status = 'OPEN' AND ends_at <= ?)
       ORDER BY ends_at ASC, id ASC
       LIMIT ?`,
      [toDatabaseTimestamp(timestamp), toDatabaseTimestamp(timestamp), limit],
    );
    return rows.map((row) => ({ id: requiredId(row.id, "schedule ID") }));
  }

  async createSchedule(
    input: NormalizedCreateScheduleInput,
  ): Promise<Schedule> {
    return this.database.transaction(async (connection) => {
      const result = await connection.execute(
        `INSERT INTO exam_schedules
           (exam_revision_id, mode, status, starts_at, ends_at,
            duration_seconds, max_attempts, hard_end, allow_late_start,
            result_release_policy, identity_fields_json)
         VALUES (?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.examRevisionId,
          input.mode,
          toDatabaseTimestamp(input.startsAt),
          toDatabaseTimestamp(input.endsAt),
          input.durationSeconds,
          input.maxAttempts,
          input.hardEnd,
          input.allowLateStart,
          input.resultReleasePolicy,
          input.identityFieldsJson,
        ],
      );
      const id = insertId(result, "Schedule insert");
      await insertTargets(
        connection,
        id,
        input.targetClassIds,
        input.targetParticipantIds,
      );
      const schedule = await readSchedule(connection, id);
      if (!schedule) throw new Error("Created schedule could not be read");
      return schedule;
    });
  }

  async updateSchedule(
    id: Id,
    input: NormalizedUpdateScheduleInput,
    expectedUpdatedAt: UtcTimestamp,
  ): Promise<Schedule | null> {
    return this.database.transaction(async (connection) => {
      const current = await readSchedule(connection, id, true);
      if (!current) return null;
      assertDraftAndVersion(current, expectedUpdatedAt);
      const assignments: string[] = [];
      const parameters: unknown[] = [];
      if (input.startsAt !== undefined) {
        assignments.push("starts_at = ?");
        parameters.push(toDatabaseTimestamp(input.startsAt));
      }
      if (input.endsAt !== undefined) {
        assignments.push("ends_at = ?");
        parameters.push(toDatabaseTimestamp(input.endsAt));
      }
      if (input.durationSeconds !== undefined) {
        assignments.push("duration_seconds = ?");
        parameters.push(input.durationSeconds);
      }
      if (input.maxAttempts !== undefined) {
        assignments.push("max_attempts = ?");
        parameters.push(input.maxAttempts);
      }
      if (input.hardEnd !== undefined) {
        assignments.push("hard_end = ?");
        parameters.push(input.hardEnd);
      }
      if (input.allowLateStart !== undefined) {
        assignments.push("allow_late_start = ?");
        parameters.push(input.allowLateStart);
      }
      if (input.resultReleasePolicy !== undefined) {
        assignments.push("result_release_policy = ?");
        parameters.push(input.resultReleasePolicy);
      }
      if (input.identityFieldsJson !== undefined) {
        assignments.push("identity_fields_json = ?");
        parameters.push(input.identityFieldsJson);
      }
      if (
        assignments.length === 0 &&
        input.targetClassIds === undefined &&
        input.targetParticipantIds === undefined
      )
        throw new ScheduleValidationError(
          "At least one schedule field must be updated",
          "EMPTY_UPDATE",
        );
      assignments.push("updated_at = UTC_TIMESTAMP(6)");
      const result = await connection.execute(
        `UPDATE exam_schedules SET ${assignments.join(", ")}
         WHERE id = ? AND status = 'DRAFT' AND updated_at = ?`,
        [...parameters, id, toDatabaseTimestamp(expectedUpdatedAt)],
      );
      if (affectedRows(result) !== 1) throw new ScheduleVersionConflictError();
      if (input.targetClassIds !== undefined) {
        await connection.execute(
          "DELETE FROM exam_schedule_classes WHERE schedule_id = ?",
          [id],
        );
        await insertClassTargets(connection, id, input.targetClassIds);
      }
      if (input.targetParticipantIds !== undefined) {
        await connection.execute(
          "DELETE FROM exam_schedule_participants WHERE schedule_id = ?",
          [id],
        );
        await insertParticipantTargets(
          connection,
          id,
          input.targetParticipantIds,
        );
      }
      return readSchedule(connection, id);
    });
  }

  async deleteSchedule(
    id: Id,
    expectedUpdatedAt: UtcTimestamp,
  ): Promise<boolean> {
    return this.database.transaction(async (connection) => {
      const current = await readSchedule(connection, id, true);
      if (!current) return false;
      assertDraftAndVersion(current, expectedUpdatedAt);

      // A draft normally has no runtime rows, but keep this guard explicit so
      // a partially-started or imported schedule cannot be hard-deleted after
      // it has become part of the audit/runtime history.
      const runtimeRows = await connection.query<{ has_runtime_refs: unknown }>(
        `SELECT (
           EXISTS (SELECT 1 FROM exam_sessions WHERE schedule_id = ?) OR
           EXISTS (SELECT 1 FROM exam_attempt_grants WHERE schedule_id = ?) OR
           EXISTS (SELECT 1 FROM export_jobs WHERE schedule_id = ?)
         ) AS has_runtime_refs`,
        [id, id, id],
      );
      if (
        runtimeRows[0]?.has_runtime_refs === true ||
        runtimeRows[0]?.has_runtime_refs === 1 ||
        runtimeRows[0]?.has_runtime_refs === 1n ||
        runtimeRows[0]?.has_runtime_refs === "1"
      )
        throw new ScheduleImmutableError(
          "Schedule dengan data runtime tidak dapat dihapus",
        );

      await connection.execute(
        "DELETE FROM exam_schedule_classes WHERE schedule_id = ?",
        [id],
      );
      await connection.execute(
        "DELETE FROM exam_schedule_participants WHERE schedule_id = ?",
        [id],
      );
      const result = await connection.execute(
        `DELETE FROM exam_schedules
         WHERE id = ? AND status = 'DRAFT' AND updated_at = ?`,
        [id, toDatabaseTimestamp(expectedUpdatedAt)],
      );
      if (affectedRows(result) !== 1) throw new ScheduleVersionConflictError();
      return true;
    });
  }

  async updateAccessCode(
    id: Id,
    field: ScheduleAccessField,
    digest: Uint8Array,
    hint: string,
    expectedUpdatedAt: UtcTimestamp,
  ): Promise<Schedule | null> {
    try {
      return await this.database.transaction(async (connection) => {
        const current = await readSchedule(connection, id, true);
        if (!current) return null;
        if (
          current.status !== "DRAFT" &&
          current.status !== "READY" &&
          current.status !== "OPEN"
        )
          throw new ScheduleImmutableError(
            "Access code cannot be changed after a schedule is closed",
          );
        if (!sameTimestamp(current.updatedAt, expectedUpdatedAt))
          throw new ScheduleVersionConflictError();
        const column =
          field === "PRACTICE_TOKEN"
            ? "practice_token_hash"
            : field === "MAIN_ACCESS_CODE"
              ? "main_access_code_hash"
              : null;
        const hintColumn =
          field === "PRACTICE_TOKEN"
            ? "practice_token_hint"
            : field === "MAIN_ACCESS_CODE"
              ? "main_access_code_hint"
              : null;
        if (!column || !hintColumn)
          throw new ScheduleValidationError(
            "Access code field is invalid",
            "INVALID_ACCESS_CODE_FIELD",
          );
        const result = await connection.execute(
          `UPDATE exam_schedules SET ${column} = ?, ${hintColumn} = ?,
             updated_at = UTC_TIMESTAMP(6)
           WHERE id = ? AND updated_at = ?`,
          [digest, hint, id, toDatabaseTimestamp(expectedUpdatedAt)],
        );
        if (affectedRows(result) !== 1)
          throw new ScheduleVersionConflictError();
        return readSchedule(connection, id);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ScheduleAccessCodeConflictError();
      throw error;
    }
  }

  async transitionSchedule(
    id: Id,
    targetStatus: ScheduleTransition,
    expectedUpdatedAt: UtcTimestamp,
    options: ScheduleTransitionOptions = {},
  ): Promise<Schedule | null> {
    return this.database.transaction(async (connection) => {
      const current = await readSchedule(connection, id, true);
      if (!current) return null;
      if (!sameTimestamp(current.updatedAt, expectedUpdatedAt))
        throw new ScheduleVersionConflictError();
      assertAllowedTransition(current.status, targetStatus);
      let result: DatabaseResult;
      if (targetStatus === "CLOSED") {
        const reason = options.closeReason?.trim() || null;
        const actorId = options.closedByUserId ?? null;
        if (actorId !== null && reason === null)
          throw new ScheduleValidationError(
            "closeReason is required when a staff member closes a schedule",
            "CLOSE_REASON_REQUIRED",
          );
        if (reason !== null && (reason.length < 1 || reason.length > 500))
          throw new ScheduleValidationError(
            "closeReason must contain between 1 and 500 characters",
            "INVALID_CLOSE_REASON",
          );
        result = await connection.execute(
          `UPDATE exam_schedules
           SET status = 'CLOSED', closed_at = UTC_TIMESTAMP(6),
               closed_by_user_id = ?, close_reason = ?,
               updated_at = UTC_TIMESTAMP(6)
           WHERE id = ? AND updated_at = ?`,
          [actorId, reason, id, toDatabaseTimestamp(expectedUpdatedAt)],
        );
      } else {
        result = await connection.execute(
          `UPDATE exam_schedules SET status = ?, updated_at = UTC_TIMESTAMP(6)
           WHERE id = ? AND updated_at = ?`,
          [targetStatus, id, toDatabaseTimestamp(expectedUpdatedAt)],
        );
      }
      if (affectedRows(result) !== 1) throw new ScheduleVersionConflictError();
      return readSchedule(connection, id);
    });
  }
}

type ExamRevisionRow = Record<string, unknown> & {
  id: unknown;
  exam_id: unknown;
  subject_id: unknown;
  owner_teacher_id: unknown;
  revision_status: unknown;
  exam_status: unknown;
};

type ScheduleRow = Record<string, unknown> & {
  id: unknown;
  exam_revision_id: unknown;
  exam_id: unknown;
  subject_id: unknown;
  owner_teacher_id: unknown;
  revision_status: unknown;
  exam_status: unknown;
  mode: unknown;
  status: unknown;
  starts_at: unknown;
  ends_at: unknown;
  duration_seconds: unknown;
  max_attempts: unknown;
  hard_end: unknown;
  allow_late_start: unknown;
  result_release_policy: unknown;
  has_practice_token: unknown;
  practice_token_hint: unknown;
  has_main_access_code: unknown;
  main_access_code_hint: unknown;
  identity_fields_json: unknown;
  closed_at: unknown;
  closed_by_user_id: unknown;
  close_reason: unknown;
  created_at: unknown;
  updated_at: unknown;
};

const SCHEDULE_COLUMNS = `
  SELECT es.id, es.exam_revision_id, er.exam_id, e.subject_id,
         e.owner_teacher_id, er.status AS revision_status,
         e.status AS exam_status, es.mode, es.status,
         DATE_FORMAT(es.starts_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS starts_at,
         DATE_FORMAT(es.ends_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS ends_at,
         es.duration_seconds, es.max_attempts, es.hard_end,
         es.allow_late_start, es.result_release_policy,
         (es.practice_token_hash IS NOT NULL) AS has_practice_token,
         es.practice_token_hint,
         (es.main_access_code_hash IS NOT NULL) AS has_main_access_code,
         es.main_access_code_hint, es.identity_fields_json,
         DATE_FORMAT(es.closed_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS closed_at,
         es.closed_by_user_id, es.close_reason,
         DATE_FORMAT(es.created_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS created_at,
         DATE_FORMAT(es.updated_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS updated_at
  FROM exam_schedules es
  JOIN exam_revisions er ON er.id = es.exam_revision_id
  JOIN exams e ON e.id = er.exam_id`;

async function readSchedule(
  connection: DatabaseConnection,
  id: Id,
  lock = false,
): Promise<Schedule | null> {
  const rows = await connection.query<ScheduleRow>(
    `${SCHEDULE_COLUMNS} WHERE es.id = ? LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  const classRows = await connection.query<{ class_id: unknown }>(
    `SELECT class_id FROM exam_schedule_classes
     WHERE schedule_id = ? ORDER BY class_id ASC`,
    [id],
  );
  const participantRows = await connection.query<{ participant_id: unknown }>(
    `SELECT participant_id FROM exam_schedule_participants
     WHERE schedule_id = ? ORDER BY participant_id ASC`,
    [id],
  );
  return mapSchedule(
    row,
    classRows.map((item) => requiredId(item.class_id, "class ID")),
    participantRows.map((item) =>
      requiredId(item.participant_id, "participant ID"),
    ),
  );
}

async function insertTargets(
  connection: DatabaseConnection,
  scheduleId: Id,
  classIds: readonly Id[],
  participantIds: readonly Id[],
): Promise<void> {
  await assertActiveTargets(connection, classIds, participantIds);
  await insertClassTargets(connection, scheduleId, classIds);
  await insertParticipantTargets(connection, scheduleId, participantIds);
}

async function insertClassTargets(
  connection: DatabaseConnection,
  scheduleId: Id,
  ids: readonly Id[],
): Promise<void> {
  await assertActiveTargets(connection, ids, []);
  for (const classId of ids)
    await connection.execute(
      `INSERT INTO exam_schedule_classes (schedule_id, class_id) VALUES (?, ?)`,
      [scheduleId, classId],
    );
}

async function insertParticipantTargets(
  connection: DatabaseConnection,
  scheduleId: Id,
  ids: readonly Id[],
): Promise<void> {
  await assertActiveTargets(connection, [], ids);
  for (const participantId of ids)
    await connection.execute(
      `INSERT INTO exam_schedule_participants (schedule_id, participant_id) VALUES (?, ?)`,
      [scheduleId, participantId],
    );
}

async function assertActiveTargets(
  connection: DatabaseConnection,
  classIds: readonly Id[],
  participantIds: readonly Id[],
): Promise<void> {
  if (classIds.length > 0) {
    const rows = await connection.query<{ id: unknown }>(
      `SELECT id FROM classes
       WHERE status = 'ACTIVE' AND id IN (${placeholders(classIds.length)})
       FOR UPDATE`,
      classIds,
    );
    if (rows.length !== classIds.length)
      throw new ScheduleValidationError(
        "Every schedule class target must exist and be active",
        "INVALID_CLASS_TARGET",
      );
  }
  if (participantIds.length > 0) {
    const rows = await connection.query<{ id: unknown }>(
      `SELECT id FROM users
       WHERE role = 'PARTICIPANT' AND status = 'ACTIVE'
         AND id IN (${placeholders(participantIds.length)})
       FOR UPDATE`,
      participantIds,
    );
    if (rows.length !== participantIds.length)
      throw new ScheduleValidationError(
        "Every schedule participant target must be an active participant",
        "INVALID_PARTICIPANT_TARGET",
      );
  }
}

function mapExamReference(row: ExamRevisionRow): ScheduleExamReference {
  const revisionStatus = row.revision_status;
  const examStatus = row.exam_status;
  if (revisionStatus !== "DRAFT" && revisionStatus !== "PUBLISHED")
    throw new Error("Database returned invalid exam revision status");
  if (
    examStatus !== "DRAFT" &&
    examStatus !== "PUBLISHED" &&
    examStatus !== "ARCHIVED"
  )
    throw new Error("Database returned invalid exam status");
  return {
    id: requiredId(row.id, "exam revision ID"),
    examId: requiredId(row.exam_id, "exam ID"),
    subjectId: requiredId(row.subject_id, "subject ID"),
    ownerTeacherId: requiredId(row.owner_teacher_id, "owner teacher ID"),
    revisionStatus,
    examStatus,
  };
}

function mapSchedule(
  row: ScheduleRow,
  targetClassIds: readonly Id[],
  targetParticipantIds: readonly Id[],
): Schedule {
  const mode = row.mode;
  const status = row.status;
  const policy = row.result_release_policy;
  if (mode !== "MAIN" && mode !== "PRACTICE")
    throw new Error("Database returned invalid schedule mode");
  if (!SCHEDULE_STATUSES.includes(status as ScheduleStatus))
    throw new Error("Database returned invalid schedule status");
  if (policy !== "MANUAL" && policy !== "IMMEDIATE_SCORE")
    throw new Error("Database returned invalid result release policy");
  const durationSeconds = numberValue(row.duration_seconds, "durationSeconds");
  const maxAttempts = numberValue(row.max_attempts, "maxAttempts");
  if (row.hard_end !== true && row.hard_end !== 1 && row.hard_end !== "1")
    throw new Error("Database returned schedule without hard end");
  const identityFields = parseIdentityFields(row.identity_fields_json);
  return {
    id: requiredId(row.id, "schedule ID"),
    examRevisionId: requiredId(row.exam_revision_id, "exam revision ID"),
    exam: {
      id: requiredId(row.exam_revision_id, "exam revision ID"),
      examId: requiredId(row.exam_id, "exam ID"),
      subjectId: requiredId(row.subject_id, "subject ID"),
      ownerTeacherId: requiredId(row.owner_teacher_id, "owner teacher ID"),
      revisionStatus:
        row.revision_status as ScheduleExamReference["revisionStatus"],
      examStatus: row.exam_status as ScheduleExamReference["examStatus"],
    },
    mode,
    status: status as ScheduleStatus,
    startsAt: requiredTimestamp(row.starts_at),
    endsAt: requiredTimestamp(row.ends_at),
    durationSeconds,
    maxAttempts,
    hardEnd: true,
    allowLateStart: toBoolean(row.allow_late_start),
    resultReleasePolicy: policy as ResultReleasePolicy,
    hasPracticeToken: toBoolean(row.has_practice_token),
    practiceTokenHint: nullableString(row.practice_token_hint),
    hasMainAccessCode: toBoolean(row.has_main_access_code),
    mainAccessCodeHint: nullableString(row.main_access_code_hint),
    identityFields,
    targetClassIds,
    targetParticipantIds,
    closedAt: nullableTimestamp(row.closed_at),
    closedByUserId: nullableId(row.closed_by_user_id),
    closeReason: nullableString(row.close_reason),
    createdAt: requiredTimestamp(row.created_at),
    updatedAt: requiredTimestamp(row.updated_at),
  };
}

function parseIdentityFields(
  value: unknown,
): readonly ScheduleIdentityField[] | null {
  if (value === null || value === undefined || value === "") return null;
  let parsed: unknown;
  try {
    parsed = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    throw new Error("Database returned invalid identity fields JSON");
  }
  if (!Array.isArray(parsed))
    throw new Error("Database returned invalid identity fields JSON");
  return parsed as readonly ScheduleIdentityField[];
}

function assertDraftAndVersion(
  schedule: Schedule,
  expected: UtcTimestamp,
): void {
  if (schedule.status !== "DRAFT") throw new ScheduleImmutableError();
  if (!sameTimestamp(schedule.updatedAt, expected))
    throw new ScheduleVersionConflictError();
}

function assertAllowedTransition(
  current: ScheduleStatus,
  target: ScheduleTransition,
): void {
  const allowed: Record<ScheduleStatus, readonly ScheduleTransition[]> = {
    DRAFT: ["READY"],
    READY: ["OPEN", "CLOSED"],
    OPEN: ["CLOSED"],
    CLOSED: ["ARCHIVED"],
    ARCHIVED: [],
  };
  if (!allowed[current].includes(target))
    throw new ScheduleTransitionError(
      `Cannot transition schedule from ${current} to ${target}`,
      "INVALID_SCHEDULE_TRANSITION",
    );
}

function insertId(result: unknown, label: string): Id {
  const id = (result as { insertId?: unknown } | null)?.insertId;
  if (typeof id !== "bigint") throw new Error(`${label} did not return an ID`);
  return formatId(id);
}

function affectedRows(result: unknown): number {
  const value = (result as { affectedRows?: unknown } | null)?.affectedRows;
  if (typeof value !== "number" || !Number.isSafeInteger(value))
    throw new Error("Database returned invalid affected row count");
  return value;
}

function requiredId(value: unknown, field: string): Id {
  if (typeof value === "bigint") return formatId(value);
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
    return formatId(BigInt(value));
  const parsed = parseId(value);
  if (!parsed) throw new Error(`Database returned invalid ${field}`);
  return parsed;
}

function nullableId(value: unknown): Id | null {
  return value === null || value === undefined ? null : requiredId(value, "ID");
}

function numberValue(value: unknown, field: string): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < 1)
    throw new Error(`Database returned invalid ${field}`);
  return number;
}

function toBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function requiredTimestamp(value: unknown): UtcTimestamp {
  if (value instanceof Date) return formatUtcTimestamp(value);
  if (typeof value === "string") {
    const parsed = parseUtcTimestamp(
      value.endsWith("Z") ? value : `${value.replace(" ", "T")}Z`,
    );
    if (parsed) return canonicalDatabaseTimestamp(parsed);
  }
  throw new Error("Database returned invalid timestamp");
}

function nullableTimestamp(value: unknown): UtcTimestamp | null {
  return value === null || value === undefined
    ? null
    : requiredTimestamp(value);
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function toDatabaseTimestamp(value: UtcTimestamp): string {
  return canonicalDatabaseTimestamp(value).replace("T", " ").replace(/Z$/u, "");
}

function sameTimestamp(left: UtcTimestamp, right: UtcTimestamp): boolean {
  return canonicalDatabaseTimestamp(left) === canonicalDatabaseTimestamp(right);
}

function canonicalDatabaseTimestamp(value: UtcTimestamp): UtcTimestamp {
  const withoutZone = value.endsWith("Z") ? value.slice(0, -1) : value;
  const [date, fraction = ""] = withoutZone.split(".");
  return `${date}.${fraction.padEnd(6, "0").slice(0, 6)}Z` as UtcTimestamp;
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: unknown; errno?: unknown } | null;
  const code = String(candidate?.code ?? candidate?.errno ?? "");
  return code === "ER_DUP_ENTRY" || code === "1062";
}
