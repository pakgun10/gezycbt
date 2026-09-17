import {
  type Id,
  parseUtcTimestamp,
  type UtcTimestamp,
} from "@gezycbt/contracts";
import type { DatabasePort } from "@gezycbt/database";
import type {
  ExamSessionStatus,
  FinalizationReason,
} from "../exam-sessions/domain";
import type { IntegrationAuthentication, IntegrationGrant } from "./domain";
import type { IntegrationService } from "./service";

const FINALIZATION_REASONS = new Set<FinalizationReason>([
  "PARTICIPANT_SUBMIT",
  "DEADLINE",
  "SCHEDULE_CLOSE",
  "STAFF_END",
  "RESET_ATTEMPT",
]);
const SESSION_STATUSES = new Set<ExamSessionStatus>([
  "ACTIVE",
  "SUBMITTED",
  "EXPIRED",
  "ENDED",
  "SCORED",
]);

export interface AgentResultQuery {
  readonly cursor?: Id;
  readonly limit: number;
  readonly filter?: "RELEASED" | "UNRELEASED";
}

export interface AgentScheduleResultSummary {
  readonly scheduleId: Id;
  readonly examId: Id;
  readonly examTitle: string;
  readonly subjectId: Id;
  readonly ownerTeacherId: Id;
  readonly mode: "MAIN" | "PRACTICE";
  readonly scheduleStatus: string;
  readonly targetClassCount: number;
  readonly targetParticipantCount: number;
  readonly sessions: {
    readonly total: number;
    readonly active: number;
    readonly submitted: number;
    readonly expired: number;
    readonly ended: number;
    readonly scored: number;
  };
  readonly results: {
    readonly total: number;
    readonly released: number;
    readonly unreleased: number;
  };
}

export interface AgentExamResultView {
  readonly id: Id;
  readonly sessionId: Id;
  readonly scheduleId: Id;
  readonly mode: "MAIN" | "PRACTICE";
  readonly participantId?: Id | null;
  readonly participantName: string;
  readonly identity?: {
    readonly name: string;
    readonly class: string | null;
    readonly institution: string | null;
    readonly extra: Readonly<Record<string, string>>;
  };
  readonly attemptNo: number;
  readonly sessionStatus: ExamSessionStatus;
  readonly finalizationReason: FinalizationReason | null;
  readonly correctCount: number;
  readonly incorrectCount: number;
  readonly unansweredCount: number;
  readonly earnedScore: string;
  readonly maxScore: string;
  readonly percentage: string;
  readonly releasedAt: UtcTimestamp | null;
  readonly scoredAt: UtcTimestamp;
  readonly canRetry?: boolean;
  readonly canRetryReason?:
    | "SCHEDULE_CLOSED"
    | "ATTEMPT_LIMIT_REACHED"
    | "TOKEN_INVALID_OR_EXPIRED"
    | null;
}

interface ScheduleResultContext {
  readonly scheduleId: Id;
  readonly examId: Id;
  readonly examTitle: string;
  readonly subjectId: Id;
  readonly ownerTeacherId: Id;
  readonly mode: "MAIN" | "PRACTICE";
  readonly status: string;
}

type Row = Record<string, unknown>;

export class AgentResultNotFoundError extends Error {
  constructor() {
    super("Schedule or result was not found");
    this.name = "AgentResultNotFoundError";
  }
}

export class IntegrationResultReadService {
  constructor(
    private readonly options: {
      readonly database: DatabasePort;
      readonly integration: IntegrationService;
    },
  ) {}

  async getScheduleSummary(
    authentication: IntegrationAuthentication,
    scheduleId: Id,
    requestId: string,
  ): Promise<AgentScheduleResultSummary> {
    const schedule = await this.requireSchedule(scheduleId);
    const grant = await this.requireCapability(
      authentication,
      schedule.mode,
      requestId,
    );
    await this.assertScope(authentication, grant, schedule);
    const [sessionRows, resultRows, targetRows] = await Promise.all([
      this.options.database.query<Row>(
        "SELECT status, COUNT(*) AS count FROM exam_sessions WHERE schedule_id = ? GROUP BY status",
        [scheduleId],
      ),
      this.options.database.query<Row>(
        "SELECT COUNT(*) AS total, SUM(released_at IS NOT NULL) AS released FROM exam_results WHERE schedule_id = ?",
        [scheduleId],
      ),
      this.options.database.query<Row>(
        "SELECT (SELECT COUNT(*) FROM exam_schedule_classes WHERE schedule_id = ?) AS class_count, (SELECT COUNT(*) FROM exam_schedule_participants WHERE schedule_id = ?) AS participant_count",
        [scheduleId, scheduleId],
      ),
    ]);
    const sessions = {
      total: 0,
      active: 0,
      submitted: 0,
      expired: 0,
      ended: 0,
      scored: 0,
    };
    for (const row of sessionRows) {
      const status = String(row.status).toLowerCase();
      const count = toNumber(row.count);
      sessions.total += count;
      if (status === "active") sessions.active += count;
      else if (status === "submitted") sessions.submitted += count;
      else if (status === "expired") sessions.expired += count;
      else if (status === "ended") sessions.ended += count;
      else if (status === "scored") sessions.scored += count;
    }
    const result = resultRows[0];
    const totalResults = toNumber(result?.total);
    const released = toNumber(result?.released);
    const targets = targetRows[0];
    return {
      scheduleId: schedule.scheduleId,
      examId: schedule.examId,
      examTitle: schedule.examTitle,
      subjectId: schedule.subjectId,
      ownerTeacherId: schedule.ownerTeacherId,
      mode: schedule.mode,
      scheduleStatus: schedule.status,
      targetClassCount: toNumber(targets?.class_count),
      targetParticipantCount: toNumber(targets?.participant_count),
      sessions,
      results: {
        total: totalResults,
        released,
        unreleased: Math.max(0, totalResults - released),
      },
    };
  }

  async listScheduleResults(
    authentication: IntegrationAuthentication,
    scheduleId: Id,
    query: AgentResultQuery,
    requestId: string,
  ): Promise<{
    readonly items: readonly AgentExamResultView[];
    readonly nextCursor: Id | null;
  }> {
    const schedule = await this.requireSchedule(scheduleId);
    const grant = await this.requireCapability(
      authentication,
      schedule.mode,
      requestId,
    );
    await this.assertScope(authentication, grant, schedule);
    const where = ["r.schedule_id = ?"];
    const parameters: unknown[] = [scheduleId];
    if (query.filter === "RELEASED") where.push("r.released_at IS NOT NULL");
    if (query.filter === "UNRELEASED") where.push("r.released_at IS NULL");
    if (query.cursor) {
      where.push("r.id > ?");
      parameters.push(query.cursor);
    }
    parameters.push(query.limit + 1);
    const rows = await this.options.database.query<Row>(
      `SELECT r.id, r.session_id, r.schedule_id, r.participant_id,
              r.correct_count, r.incorrect_count, r.unanswered_count,
              r.earned_score, r.max_score, r.percentage, r.scored_at,
              r.released_at, s.status AS session_status, s.attempt_no,
              s.participant_name_snapshot, s.class_snapshot,
              s.institution_snapshot, s.identity_extra_json,
              s.finalization_reason
       FROM exam_results r
       JOIN exam_sessions s ON s.id = r.session_id
       WHERE ${where.join(" AND ")}
       ORDER BY r.id ASC LIMIT ?`,
      parameters,
    );
    const items = rows
      .slice(0, query.limit)
      .map((row) => presentResult(row, schedule));
    if (items.length > 0) {
      await this.auditRead(
        authentication,
        schedule,
        requestId,
        "INTEGRATION_RESULT_LIST",
        items.length,
      );
    }
    return {
      items,
      nextCursor:
        rows.length > query.limit ? requiredId(rows[query.limit]?.id) : null,
    };
  }

  async getResult(
    authentication: IntegrationAuthentication,
    sessionId: Id,
    requestId: string,
  ): Promise<AgentExamResultView> {
    const rows = await this.options.database.query<Row>(
      `SELECT r.id, r.session_id, r.schedule_id, r.participant_id,
              r.correct_count, r.incorrect_count, r.unanswered_count,
              r.earned_score, r.max_score, r.percentage, r.scored_at,
              r.released_at, s.status AS session_status, s.attempt_no,
              s.participant_name_snapshot, s.class_snapshot,
              s.institution_snapshot, s.identity_extra_json,
              s.finalization_reason
       FROM exam_results r
       JOIN exam_sessions s ON s.id = r.session_id
       WHERE r.session_id = ? LIMIT 1`,
      [sessionId],
    );
    const row = rows[0];
    if (!row) throw new AgentResultNotFoundError();
    const schedule = await this.requireSchedule(requiredId(row.schedule_id));
    const grant = await this.requireCapability(
      authentication,
      schedule.mode,
      requestId,
    );
    await this.assertScope(authentication, grant, schedule);
    await this.auditRead(
      authentication,
      schedule,
      requestId,
      "INTEGRATION_RESULT_READ",
      1,
    );
    return presentResult(row, schedule);
  }

  private async requireSchedule(
    scheduleId: Id,
  ): Promise<ScheduleResultContext> {
    const rows = await this.options.database.query<Row>(
      `SELECT es.id AS schedule_id, es.mode, es.status, er.exam_id,
              er.title, e.subject_id, e.owner_teacher_id
       FROM exam_schedules es
       JOIN exam_revisions er ON er.id = es.exam_revision_id
       JOIN exams e ON e.id = er.exam_id
       WHERE es.id = ? LIMIT 1`,
      [scheduleId],
    );
    const row = rows[0];
    if (!row) throw new AgentResultNotFoundError();
    const mode = String(row.mode);
    if (mode !== "MAIN" && mode !== "PRACTICE")
      throw new AgentResultNotFoundError();
    return {
      scheduleId: requiredId(row.schedule_id),
      examId: requiredId(row.exam_id),
      examTitle: String(row.title),
      subjectId: requiredId(row.subject_id),
      ownerTeacherId: requiredId(row.owner_teacher_id),
      mode,
      status: String(row.status),
    };
  }

  private async requireCapability(
    authentication: IntegrationAuthentication,
    mode: "MAIN" | "PRACTICE",
    requestId: string,
  ): Promise<IntegrationGrant> {
    return this.options.integration.assertCapability(
      authentication,
      mode === "PRACTICE" ? "results.read_practice" : "results.read",
      requestId,
    );
  }

  private async assertScope(
    authentication: IntegrationAuthentication,
    grant: IntegrationGrant,
    schedule: ScheduleResultContext,
  ): Promise<void> {
    await this.options.integration.assertResourceScope(authentication, grant, {
      ownerUserId: schedule.ownerTeacherId,
      subjectId: schedule.subjectId,
      resourceId: schedule.scheduleId,
    });
  }

  private async auditRead(
    authentication: IntegrationAuthentication,
    schedule: ScheduleResultContext,
    requestId: string,
    action: string,
    resultCount: number,
  ): Promise<void> {
    await this.options.integration.recordAgentAudit({
      action,
      clientId: authentication.client.id,
      actorUserId: authentication.client.ownerUserId,
      entityType: "exam_schedule",
      entityId: schedule.scheduleId,
      requestId,
      outcome: "SUCCESS",
      metadata: { mode: schedule.mode, resultCount },
    });
  }
}

function presentResult(
  row: Row,
  schedule: ScheduleResultContext,
): AgentExamResultView {
  const rawSessionStatus = String(row.session_status);
  if (!SESSION_STATUSES.has(rawSessionStatus as ExamSessionStatus))
    throw new Error("Database returned invalid session status");
  const sessionStatus = rawSessionStatus as ExamSessionStatus;
  const finalizationReason = nullableReason(row.finalization_reason);
  const base: AgentExamResultView = {
    id: requiredId(row.id),
    sessionId: requiredId(row.session_id),
    scheduleId: schedule.scheduleId,
    mode: schedule.mode,
    participantName: String(row.participant_name_snapshot ?? ""),
    attemptNo: toNumber(row.attempt_no),
    sessionStatus,
    finalizationReason,
    correctCount: toNumber(row.correct_count),
    incorrectCount: toNumber(row.incorrect_count),
    unansweredCount: toNumber(row.unanswered_count),
    earnedScore: String(row.earned_score),
    maxScore: String(row.max_score),
    percentage: String(row.percentage),
    releasedAt: nullableTimestamp(row.released_at),
    scoredAt: requiredTimestamp(row.scored_at),
  };
  if (schedule.mode === "MAIN") {
    return {
      ...base,
      participantId:
        row.participant_id === null || row.participant_id === undefined
          ? null
          : requiredId(row.participant_id),
    };
  }
  const canRetry = schedule.status === "OPEN";
  return {
    ...base,
    identity: {
      name: String(row.participant_name_snapshot ?? ""),
      class: nullableText(row.class_snapshot),
      institution: nullableText(row.institution_snapshot),
      extra: parseIdentityExtra(row.identity_extra_json),
    },
    canRetry,
    canRetryReason: canRetry
      ? null
      : schedule.status === "CLOSED" || schedule.status === "ARCHIVED"
        ? "SCHEDULE_CLOSED"
        : "TOKEN_INVALID_OR_EXPIRED",
  };
}

function parseIdentityExtra(value: unknown): Readonly<Record<string, string>> {
  if (value === null || value === undefined || value === "") return {};
  try {
    const parsed: unknown =
      typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([key, item]) =>
          key.length <= 64 &&
          !["name", "class", "institution"].includes(key) &&
          typeof item === "string" &&
          item.length <= 200,
      ),
    );
  } catch {
    return {};
  }
}

function nullableReason(value: unknown): FinalizationReason | null {
  const candidate = String(value ?? "");
  return FINALIZATION_REASONS.has(candidate as FinalizationReason)
    ? (candidate as FinalizationReason)
    : null;
}

function requiredId(value: unknown): Id {
  const candidate = String(value ?? "");
  if (!/^\d+$/u.test(candidate))
    throw new Error("Database returned invalid ID");
  return candidate as Id;
}

function requiredTimestamp(value: unknown): UtcTimestamp {
  const raw = String(value ?? "");
  const candidate =
    value instanceof Date
      ? value.toISOString()
      : raw.endsWith("Z")
        ? raw
        : `${raw.replace(" ", "T")}Z`;
  const parsed = parseUtcTimestamp(candidate);
  if (!parsed) throw new Error("Database returned invalid timestamp");
  return parsed;
}

function nullableTimestamp(value: unknown): UtcTimestamp | null {
  if (value === null || value === undefined) return null;
  return requiredTimestamp(value);
}

function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
