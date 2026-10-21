import type { DatabasePort } from "@gezycbt/database";
import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import {
  IntegrationConflictError,
  IntegrationNotFoundError,
  IntegrationScopeError,
  IntegrationValidationError,
  type IntegrationAuthentication,
} from "./domain";
import type { IntegrationService } from "./service";

type Row = Record<string, unknown>;

export interface IntegrationResourceOptions {
  readonly database: DatabasePort;
  readonly integration: IntegrationService;
}

export class IntegrationResourceService {
  constructor(private readonly options: IntegrationResourceOptions) {}

  async getQuestionBank(
    authentication: IntegrationAuthentication,
    id: Id,
    requestId: string,
  ) {
    const grant = await this.options.integration.assertCapability(
      authentication,
      "question_banks.read",
      requestId,
    );
    const row = await this.one(
      `SELECT qb.id, qb.subject_id, qb.owner_teacher_id, qb.name, qb.status,
              qb.updated_at, s.code AS subject_code, s.name AS subject_name
       FROM question_banks qb JOIN subjects s ON s.id = qb.subject_id
       WHERE qb.id = ? LIMIT 1`,
      [id],
    );
    if (!row) throw new IntegrationNotFoundError("Question bank was not found");
    await this.options.integration.assertResourceScope(authentication, grant, {
      ownerUserId: String(row.owner_teacher_id) as Id,
      subjectId: String(row.subject_id) as Id,
      resourceId: id,
    });
    return mapQuestionBank(row);
  }

  async createQuestionBank(
    authentication: IntegrationAuthentication,
    input: { readonly subjectId: Id; readonly ownerTeacherId?: Id; readonly name: string },
    requestId: string,
  ) {
    const grant = await this.options.integration.assertCapability(
      authentication,
      "question_banks.write",
      requestId,
    );
    const ownerTeacherId =
      authentication.client.ownerRole === "TEACHER"
        ? authentication.client.ownerUserId
        : input.ownerTeacherId;
    if (!ownerTeacherId)
      throw new IntegrationValidationError(
        "ownerTeacherId is required for an ADMIN client",
      );
    await this.options.integration.assertResourceScope(authentication, grant, {
      ownerUserId: ownerTeacherId,
      subjectId: input.subjectId,
    });
    const result = await this.options.database.execute(
      "INSERT INTO question_banks (subject_id, owner_teacher_id, name, status) VALUES (?, ?, ?, 'ACTIVE')",
      [input.subjectId, ownerTeacherId, input.name.trim()],
    );
    const id = insertId(result);
    const created = await this.getQuestionBank(authentication, id, requestId);
    await this.audit(authentication, "INTEGRATION_QUESTION_BANK_CREATE", id, requestId);
    return created;
  }

  async updateQuestionBank(
    authentication: IntegrationAuthentication,
    id: Id,
    input: { readonly name?: string; readonly status?: "ACTIVE" | "ARCHIVED" },
    expectedUpdatedAt: UtcTimestamp,
    requestId: string,
  ) {
    const grant = await this.options.integration.assertCapability(
      authentication,
      "question_banks.write",
      requestId,
    );
    const current = await this.one(
      "SELECT id, subject_id, owner_teacher_id, name, status, updated_at FROM question_banks WHERE id = ? LIMIT 1",
      [id],
    );
    if (!current)
      throw new IntegrationNotFoundError("Question bank was not found");
    await this.options.integration.assertResourceScope(authentication, grant, {
      ownerUserId: String(current.owner_teacher_id) as Id,
      subjectId: String(current.subject_id) as Id,
      resourceId: id,
    });
    const result = await this.options.database.execute(
      `UPDATE question_banks SET name = ?, status = ?, updated_at = UTC_TIMESTAMP(6)
       WHERE id = ? AND updated_at = ?`,
      [input.name?.trim() ?? String(current.name), input.status ?? String(current.status), id, databaseTimestamp(expectedUpdatedAt)],
    );
    if (affectedRows(result) !== 1)
      throw new IntegrationConflictError("Question bank version conflict");
    return this.getQuestionBank(authentication, id, requestId);
  }

  async archiveQuestion(
    authentication: IntegrationAuthentication,
    id: Id,
    expectedUpdatedAt: UtcTimestamp,
    requestId: string,
  ) {
    const grant = await this.options.integration.assertCapability(
      authentication,
      "questions.archive",
      requestId,
    );
    const row = await this.one(
      `SELECT q.id, q.status, q.updated_at, qb.subject_id, qb.owner_teacher_id
       FROM questions q JOIN question_banks qb ON qb.id = q.question_bank_id
       WHERE q.id = ? LIMIT 1`,
      [id],
    );
    if (!row) throw new IntegrationNotFoundError("Question was not found");
    await this.options.integration.assertResourceScope(authentication, grant, {
      ownerUserId: String(row.owner_teacher_id) as Id,
      subjectId: String(row.subject_id) as Id,
      resourceId: id,
    });
    const result = await this.options.database.execute(
      "UPDATE questions SET status = 'ARCHIVED', updated_at = UTC_TIMESTAMP(6) WHERE id = ? AND updated_at = ?",
      [id, databaseTimestamp(expectedUpdatedAt)],
    );
    if (affectedRows(result) !== 1)
      throw new IntegrationConflictError("Question version conflict");
    await this.audit(authentication, "INTEGRATION_QUESTION_ARCHIVE", id, requestId);
    return { id, status: "ARCHIVED" };
  }

  async archiveExam(
    authentication: IntegrationAuthentication,
    id: Id,
    expectedUpdatedAt: UtcTimestamp,
    requestId: string,
  ) {
    const grant = await this.options.integration.assertCapability(
      authentication,
      "exams.archive",
      requestId,
    );
    const row = await this.one(
      "SELECT id, subject_id, owner_teacher_id, status, updated_at FROM exams WHERE id = ? LIMIT 1",
      [id],
    );
    if (!row) throw new IntegrationNotFoundError("Exam was not found");
    await this.options.integration.assertResourceScope(authentication, grant, {
      ownerUserId: String(row.owner_teacher_id) as Id,
      subjectId: String(row.subject_id) as Id,
      resourceId: id,
    });
    const result = await this.options.database.execute(
      "UPDATE exams SET status = 'ARCHIVED', updated_at = UTC_TIMESTAMP(6) WHERE id = ? AND updated_at = ?",
      [id, databaseTimestamp(expectedUpdatedAt)],
    );
    if (affectedRows(result) !== 1)
      throw new IntegrationConflictError("Exam version conflict");
    await this.audit(authentication, "INTEGRATION_EXAM_ARCHIVE", id, requestId);
    return { id, status: "ARCHIVED" };
  }

  async getSession(
    authentication: IntegrationAuthentication,
    id: Id,
    requestId: string,
  ) {
    const grant = await this.options.integration.assertCapability(
      authentication,
      "sessions.read",
      requestId,
    );
    const row = await this.one(
      `SELECT s.id, s.schedule_id, s.participant_id, s.status, s.version,
              s.participant_name_snapshot, s.deadline_at, s.started_at,
              s.submitted_at, e.subject_id, e.owner_teacher_id
       FROM exam_sessions s
       JOIN exam_schedules es ON es.id = s.schedule_id
       JOIN exam_revisions er ON er.id = es.exam_revision_id
       JOIN exams e ON e.id = er.exam_id
       WHERE s.id = ? LIMIT 1`,
      [id],
    );
    if (!row) throw new IntegrationNotFoundError("Session was not found");
    await this.options.integration.assertResourceScope(authentication, grant, {
      ownerUserId: String(row.owner_teacher_id) as Id,
      subjectId: String(row.subject_id) as Id,
      resourceId: String(row.schedule_id) as Id,
    });
    return mapSession(row);
  }

  async listSessions(
    authentication: IntegrationAuthentication,
    scheduleId: Id,
    requestId: string,
  ) {
    const grant = await this.options.integration.assertCapability(
      authentication,
      "sessions.monitor",
      requestId,
    );
    const schedule = await this.one(
      `SELECT es.id, e.subject_id, e.owner_teacher_id FROM exam_schedules es
       JOIN exam_revisions er ON er.id = es.exam_revision_id
       JOIN exams e ON e.id = er.exam_id WHERE es.id = ? LIMIT 1`,
      [scheduleId],
    );
    if (!schedule) throw new IntegrationNotFoundError("Schedule was not found");
    await this.options.integration.assertResourceScope(authentication, grant, {
      ownerUserId: String(schedule.owner_teacher_id) as Id,
      subjectId: String(schedule.subject_id) as Id,
      resourceId: scheduleId,
    });
    const rows = await this.options.database.query<Row>(
      `SELECT id, schedule_id, participant_id, status, version,
              participant_name_snapshot, deadline_at, started_at, submitted_at
       FROM exam_sessions WHERE schedule_id = ? ORDER BY id ASC LIMIT 100`,
      [scheduleId],
    );
    return { items: rows.map(mapSession), nextCursor: null };
  }

  async getSettings(authentication: IntegrationAuthentication, requestId: string) {
    const grant = await this.options.integration.assertCapability(
      authentication,
      "settings.read",
      requestId,
    );
    this.requireAdmin(authentication);
    await this.options.integration.assertResourceScope(authentication, grant, {});
    const row = await this.one(
      "SELECT id, school_name, school_code, address, timezone, updated_at FROM school_settings WHERE id = 1 LIMIT 1",
      [],
    );
    if (!row)
      throw new IntegrationNotFoundError("School settings were not found");
    return {
      id: "1",
      schoolName: String(row.school_name),
      schoolCode: String(row.school_code),
      address: row.address === null ? null : String(row.address),
      timezone: String(row.timezone),
      updatedAt: isoValue(row.updated_at),
    };
  }

  async updateSettings(
    authentication: IntegrationAuthentication,
    input: { readonly schoolName?: string; readonly schoolCode?: string; readonly address?: string | null; readonly timezone?: string },
    expectedUpdatedAt: UtcTimestamp | undefined,
    requestId: string,
  ) {
    const grant = await this.options.integration.assertCapability(
      authentication,
      "settings.write",
      requestId,
    );
    this.requireAdmin(authentication);
    await this.options.integration.assertResourceScope(authentication, grant, {});
    const current = await this.getSettings(authentication, requestId);
    const result = await this.options.database.execute(
      `UPDATE school_settings SET school_name = ?, school_code = ?, address = ?, timezone = ?, updated_at = UTC_TIMESTAMP(6)
       WHERE id = 1${expectedUpdatedAt ? " AND updated_at = ?" : ""}`,
      [
        input.schoolName ?? current.schoolName,
        input.schoolCode ?? current.schoolCode,
        input.address === undefined ? current.address : input.address,
        input.timezone ?? current.timezone,
        ...(expectedUpdatedAt ? [databaseTimestamp(expectedUpdatedAt)] : []),
      ],
    );
    if (expectedUpdatedAt && affectedRows(result) !== 1)
      throw new IntegrationConflictError("Settings version conflict");
    await this.audit(authentication, "INTEGRATION_SETTINGS_UPDATE", "1" as Id, requestId);
    return this.getSettings(authentication, requestId);
  }

  async listAudit(
    authentication: IntegrationAuthentication,
    requestId: string,
    limit = 50,
  ) {
    const grant = await this.options.integration.assertCapability(
      authentication,
      "audit.read",
      requestId,
    );
    this.requireAdmin(authentication);
    await this.options.integration.assertResourceScope(authentication, grant, {});
    const rows = await this.options.database.query<Row>(
      `SELECT id, action, entity_type, entity_id, actor_type, actor_user_id,
              request_id, created_at,
              JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.outcome')) AS outcome
       FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT ?`,
      [Math.min(Math.max(limit, 1), 100)],
    );
    return {
      items: rows.map((row) => ({
        id: String(row.id),
        action: String(row.action),
        outcome: row.outcome === "FAILURE" ? "FAILURE" : "SUCCESS",
        actorType: String(row.actor_type),
        actorUserId: row.actor_user_id == null ? null : String(row.actor_user_id),
        entityType: String(row.entity_type),
        entityId: row.entity_id == null ? null : String(row.entity_id),
        requestId: String(row.request_id),
        createdAt: isoValue(row.created_at),
      })),
      nextCursor: null,
    };
  }

  private async one(sql: string, params: readonly unknown[]): Promise<Row | null> {
    const rows = await this.options.database.query<Row>(sql, params);
    return rows[0] ?? null;
  }

  private requireAdmin(authentication: IntegrationAuthentication): void {
    if (authentication.client.ownerRole !== "ADMIN") throw new IntegrationScopeError();
  }

  private async audit(
    authentication: IntegrationAuthentication,
    action: string,
    entityId: Id,
    requestId: string,
  ): Promise<void> {
    await this.options.integration.recordAgentAudit({
      action,
      clientId: authentication.client.id,
      actorUserId: authentication.client.ownerUserId,
      entityType: "integration_resource",
      entityId,
      requestId,
      outcome: "SUCCESS",
    });
  }
}

function mapQuestionBank(row: Row) {
  return {
    id: String(row.id),
    subjectId: String(row.subject_id),
    subjectCode: String(row.subject_code ?? ""),
    subjectName: String(row.subject_name ?? ""),
    ownerTeacherId: String(row.owner_teacher_id),
    name: String(row.name),
    status: String(row.status),
    updatedAt: isoValue(row.updated_at),
  };
}

function mapSession(row: Row) {
  return {
    id: String(row.id),
    scheduleId: String(row.schedule_id),
    participantId: row.participant_id == null ? null : String(row.participant_id),
    participantName: String(row.participant_name_snapshot ?? ""),
    status: String(row.status),
    version: Number(row.version),
    deadlineAt: isoValue(row.deadline_at),
    startedAt: row.started_at == null ? null : isoValue(row.started_at),
    submittedAt: row.submitted_at == null ? null : isoValue(row.submitted_at),
  };
}

function insertId(result: unknown): Id {
  const value = (result as { insertId?: unknown }).insertId;
  if (value === undefined || value === null)
    throw new IntegrationValidationError("Insert did not return an ID");
  return String(value) as Id;
}

function affectedRows(result: unknown): number {
  return Number((result as { affectedRows?: unknown }).affectedRows ?? 0);
}

function databaseTimestamp(value: UtcTimestamp): string {
  return value.replace("T", " ").replace("Z", "");
}

function isoValue(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const text = String(value);
  return text.endsWith("Z") ? text : `${text.replace(" ", "T")}Z`;
}
