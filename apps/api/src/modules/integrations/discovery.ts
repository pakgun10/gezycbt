import {
  formatId,
  formatUtcTimestamp,
  type Id,
  parseId,
  parseUtcTimestamp,
  type UtcTimestamp,
} from "@gezycbt/contracts";
import type { DatabasePort } from "@gezycbt/database";
import type { IntegrationGrant, IntegrationScopeType } from "./domain";

export type DiscoveryResourceType =
  | "subjects"
  | "classes"
  | "question_banks"
  | "questions"
  | "exams"
  | "schedules";

export interface DiscoveryQuery {
  readonly q?: string;
  readonly cursor?: Id;
  readonly limit: number;
  readonly subjectId?: Id;
  readonly questionBankId?: Id;
  readonly academicYearId?: Id;
  readonly examId?: Id;
  readonly status?: string;
  readonly revisionStatus?: string;
  readonly type?: string;
  readonly mode?: string;
}

export interface DiscoveryAccess {
  readonly ownerUserId: Id;
  readonly ownerRole: "ADMIN" | "TEACHER";
  readonly teacherSubjectIds: readonly Id[];
  readonly teacherClassIds: readonly Id[];
  readonly grants: readonly IntegrationGrant[];
}

export interface DiscoveryPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: Id | null;
}

export interface DiscoverySubject {
  readonly id: Id;
  readonly code: string;
  readonly name: string;
  readonly status: string;
}

export interface DiscoveryClass {
  readonly id: Id;
  readonly academicYearId: Id;
  readonly academicYearName: string;
  readonly code: string;
  readonly name: string;
  readonly status: string;
}

export interface DiscoveryQuestionBank {
  readonly id: Id;
  readonly subjectId: Id;
  readonly subjectCode: string;
  readonly subjectName: string;
  readonly ownerTeacherId: Id;
  readonly name: string;
  readonly status: string;
}

export interface DiscoveryQuestion {
  /** Revision ID. Mutations must use this stable ID. */
  readonly id: Id;
  readonly questionId: Id;
  readonly questionBankId: Id;
  readonly subjectId: Id;
  readonly ownerTeacherId: Id;
  readonly bankName: string;
  readonly type: string;
  readonly revisionNo: number;
  readonly status: string;
  readonly questionStatus: string;
  readonly label: string;
  readonly updatedAt: UtcTimestamp;
}

export interface DiscoveryExam {
  readonly id: Id;
  readonly subjectId: Id;
  readonly ownerTeacherId: Id;
  readonly status: string;
  readonly latestRevisionId: Id | null;
  readonly latestRevisionStatus: string | null;
  readonly title: string | null;
  readonly updatedAt: UtcTimestamp;
}

export interface DiscoverySchedule {
  readonly id: Id;
  readonly examId: Id;
  readonly examRevisionId: Id;
  readonly subjectId: Id;
  readonly ownerTeacherId: Id;
  readonly examTitle: string;
  readonly mode: string;
  readonly status: string;
  readonly startsAt: UtcTimestamp;
  readonly endsAt: UtcTimestamp;
  readonly durationSeconds: number;
  readonly resultReleasePolicy: string;
  readonly targetClassCount: number;
  readonly targetParticipantCount: number;
}

export interface IntegrationDiscoveryRepository {
  searchSubjects(
    query: DiscoveryQuery,
    access: DiscoveryAccess,
  ): Promise<DiscoveryPage<DiscoverySubject>>;
  searchClasses(
    query: DiscoveryQuery,
    access: DiscoveryAccess,
  ): Promise<DiscoveryPage<DiscoveryClass>>;
  searchQuestionBanks(
    query: DiscoveryQuery,
    access: DiscoveryAccess,
  ): Promise<DiscoveryPage<DiscoveryQuestionBank>>;
  searchQuestions(
    query: DiscoveryQuery,
    access: DiscoveryAccess,
  ): Promise<DiscoveryPage<DiscoveryQuestion>>;
  searchExams(
    query: DiscoveryQuery,
    access: DiscoveryAccess,
  ): Promise<DiscoveryPage<DiscoveryExam>>;
  searchSchedules(
    query: DiscoveryQuery,
    access: DiscoveryAccess,
  ): Promise<DiscoveryPage<DiscoverySchedule>>;
}

type DatabaseQuery = Pick<DatabasePort, "query">;
type Row = Record<string, unknown>;

const RESOURCE_CAPABILITIES = {
  subjects: "subjects.read",
  classes: "classes.read",
  question_banks: "question_banks.read",
  questions: "questions.read",
  exams: "exams.read",
  schedules: "schedules.read",
} as const;

export function discoveryCapability(
  resource: DiscoveryResourceType,
): (typeof RESOURCE_CAPABILITIES)[DiscoveryResourceType] {
  return RESOURCE_CAPABILITIES[resource];
}

export class SqlIntegrationDiscoveryRepository
  implements IntegrationDiscoveryRepository
{
  constructor(private readonly database: DatabaseQuery) {}

  async searchSubjects(
    query: DiscoveryQuery,
    access: DiscoveryAccess,
  ): Promise<DiscoveryPage<DiscoverySubject>> {
    const where = ["s.status IN ('ACTIVE', 'ARCHIVED')"];
    const parameters: unknown[] = [];
    addTextSearch(where, parameters, query.q, ["s.code", "s.name"]);
    if (query.status) addEquals(where, parameters, "s.status", query.status);
    if (query.subjectId) addEquals(where, parameters, "s.id", query.subjectId);
    if (query.cursor) addCursor(where, parameters, "s.id", query.cursor);
    addScope(where, parameters, access, {
      subjectColumn: "s.id",
      teacherSubjectColumn: "s.id",
    });
    const rows = await this.database.query<Row>(
      `SELECT s.id, s.code, s.name, s.status
       FROM subjects s
       WHERE ${where.join(" AND ")}
       ORDER BY s.id ASC LIMIT ?`,
      [...parameters, query.limit + 1],
    );
    return page(rows, query.limit, mapSubject);
  }

  async searchClasses(
    query: DiscoveryQuery,
    access: DiscoveryAccess,
  ): Promise<DiscoveryPage<DiscoveryClass>> {
    const where = ["c.status IN ('ACTIVE', 'ARCHIVED')"];
    const parameters: unknown[] = [];
    addTextSearch(where, parameters, query.q, ["c.code", "c.name", "ay.name"]);
    if (query.status) addEquals(where, parameters, "c.status", query.status);
    if (query.academicYearId)
      addEquals(where, parameters, "c.academic_year_id", query.academicYearId);
    if (query.cursor) addCursor(where, parameters, "c.id", query.cursor);
    addScope(where, parameters, access, {
      classColumn: "c.id",
      academicYearColumn: "c.academic_year_id",
      teacherClassColumn: "c.id",
    });
    const rows = await this.database.query<Row>(
      `SELECT c.id, c.academic_year_id, ay.name AS academic_year_name,
              c.code, c.name, c.status
       FROM classes c
       JOIN academic_years ay ON ay.id = c.academic_year_id
       WHERE ${where.join(" AND ")}
       ORDER BY c.id ASC LIMIT ?`,
      [...parameters, query.limit + 1],
    );
    return page(rows, query.limit, mapClass);
  }

  async searchQuestionBanks(
    query: DiscoveryQuery,
    access: DiscoveryAccess,
  ): Promise<DiscoveryPage<DiscoveryQuestionBank>> {
    const where = ["qb.status IN ('ACTIVE', 'ARCHIVED')"];
    const parameters: unknown[] = [];
    addTextSearch(where, parameters, query.q, ["qb.name", "s.code", "s.name"]);
    if (query.status) addEquals(where, parameters, "qb.status", query.status);
    if (query.subjectId)
      addEquals(where, parameters, "qb.subject_id", query.subjectId);
    if (query.cursor) addCursor(where, parameters, "qb.id", query.cursor);
    addScope(where, parameters, access, {
      subjectColumn: "qb.subject_id",
      questionBankColumn: "qb.id",
      ownerColumn: "qb.owner_teacher_id",
      teacherSubjectColumn: "qb.subject_id",
    });
    const rows = await this.database.query<Row>(
      `SELECT qb.id, qb.subject_id, s.code AS subject_code,
              s.name AS subject_name, qb.owner_teacher_id, qb.name, qb.status
       FROM question_banks qb
       JOIN subjects s ON s.id = qb.subject_id
       WHERE ${where.join(" AND ")}
       ORDER BY qb.id ASC LIMIT ?`,
      [...parameters, query.limit + 1],
    );
    return page(rows, query.limit, mapQuestionBank);
  }

  async searchQuestions(
    query: DiscoveryQuery,
    access: DiscoveryAccess,
  ): Promise<DiscoveryPage<DiscoveryQuestion>> {
    const where = ["q.status IN ('ACTIVE', 'ARCHIVED')"];
    const parameters: unknown[] = [];
    addTextSearch(where, parameters, query.q, [
      "qb.name",
      "qr.stimulus_html",
      "qr.prompt_html",
    ]);
    if (query.status) addEquals(where, parameters, "q.status", query.status);
    if (query.revisionStatus)
      addEquals(where, parameters, "qr.status", query.revisionStatus);
    if (query.type) addEquals(where, parameters, "qr.type", query.type);
    if (query.subjectId)
      addEquals(where, parameters, "qb.subject_id", query.subjectId);
    if (query.questionBankId)
      addEquals(where, parameters, "q.question_bank_id", query.questionBankId);
    if (query.cursor) addCursor(where, parameters, "qr.id", query.cursor);
    addScope(where, parameters, access, {
      subjectColumn: "qb.subject_id",
      questionBankColumn: "q.question_bank_id",
      ownerColumn: "qb.owner_teacher_id",
      teacherSubjectColumn: "qb.subject_id",
    });
    const rows = await this.database.query<Row>(
      `SELECT qr.id, qr.question_id, q.question_bank_id, qb.subject_id,
              qb.owner_teacher_id, qb.name AS bank_name, qr.type,
              qr.revision_no, qr.status, q.status AS question_status,
              LEFT(CONCAT(COALESCE(qr.prompt_html, ''), ' ', qr.stimulus_html), 500) AS label,
              qr.updated_at
       FROM question_revisions qr
       JOIN questions q ON q.id = qr.question_id
       JOIN question_banks qb ON qb.id = q.question_bank_id
       WHERE ${where.join(" AND ")}
       ORDER BY qr.id ASC LIMIT ?`,
      [...parameters, query.limit + 1],
    );
    return page(rows, query.limit, mapQuestion);
  }

  async searchExams(
    query: DiscoveryQuery,
    access: DiscoveryAccess,
  ): Promise<DiscoveryPage<DiscoveryExam>> {
    const where = ["e.status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')"];
    const parameters: unknown[] = [];
    addTextSearch(where, parameters, query.q, ["er.title"]);
    if (query.status) addEquals(where, parameters, "e.status", query.status);
    if (query.subjectId)
      addEquals(where, parameters, "e.subject_id", query.subjectId);
    if (query.cursor) addCursor(where, parameters, "e.id", query.cursor);
    addScope(where, parameters, access, {
      subjectColumn: "e.subject_id",
      examColumn: "e.id",
      ownerColumn: "e.owner_teacher_id",
      teacherSubjectColumn: "e.subject_id",
    });
    const rows = await this.database.query<Row>(
      `SELECT e.id, e.subject_id, e.owner_teacher_id, e.status,
              er.id AS latest_revision_id, er.status AS latest_revision_status,
              er.title, e.updated_at
       FROM exams e
       LEFT JOIN exam_revisions er
         ON er.exam_id = e.id
        AND er.revision_no = (
          SELECT MAX(er2.revision_no) FROM exam_revisions er2
          WHERE er2.exam_id = e.id
        )
       WHERE ${where.join(" AND ")}
       ORDER BY e.id ASC LIMIT ?`,
      [...parameters, query.limit + 1],
    );
    return page(rows, query.limit, mapExam);
  }

  async searchSchedules(
    query: DiscoveryQuery,
    access: DiscoveryAccess,
  ): Promise<DiscoveryPage<DiscoverySchedule>> {
    const where = [
      "es.status IN ('DRAFT', 'READY', 'OPEN', 'CLOSED', 'ARCHIVED')",
    ];
    const parameters: unknown[] = [];
    addTextSearch(where, parameters, query.q, [
      "er.title",
      "es.mode",
      "es.status",
    ]);
    if (query.status) addEquals(where, parameters, "es.status", query.status);
    if (query.mode) addEquals(where, parameters, "es.mode", query.mode);
    if (query.subjectId)
      addEquals(where, parameters, "e.subject_id", query.subjectId);
    if (query.examId) addEquals(where, parameters, "e.id", query.examId);
    if (query.academicYearId) {
      where.push(
        `EXISTS (SELECT 1 FROM exam_schedule_classes filter_esc
                JOIN classes filter_c ON filter_c.id = filter_esc.class_id
                WHERE filter_esc.schedule_id = es.id
                  AND filter_c.academic_year_id = ?)`,
      );
      parameters.push(query.academicYearId);
    }
    if (query.cursor) addCursor(where, parameters, "es.id", query.cursor);
    addScope(where, parameters, access, {
      subjectColumn: "e.subject_id",
      examColumn: "e.id",
      scheduleColumn: "es.id",
      classExpression: (ids) =>
        `EXISTS (SELECT 1 FROM exam_schedule_classes scope_esc
                WHERE scope_esc.schedule_id = es.id
                  AND scope_esc.class_id IN (${placeholders(ids.length)}))`,
      academicYearExpression: (ids) =>
        `EXISTS (SELECT 1 FROM exam_schedule_classes scope_esc
                JOIN classes scope_c ON scope_c.id = scope_esc.class_id
                WHERE scope_esc.schedule_id = es.id
                  AND scope_c.academic_year_id IN (${placeholders(ids.length)}))`,
      ownerColumn: "e.owner_teacher_id",
      teacherSubjectColumn: "e.subject_id",
    });
    const rows = await this.database.query<Row>(
      `SELECT es.id, e.id AS exam_id, es.exam_revision_id, e.subject_id,
              e.owner_teacher_id, er.title AS exam_title, es.mode, es.status,
              es.starts_at, es.ends_at, es.duration_seconds,
              es.result_release_policy,
              (SELECT COUNT(*) FROM exam_schedule_classes esc_count
               WHERE esc_count.schedule_id = es.id) AS target_class_count,
              (SELECT COUNT(*) FROM exam_schedule_participants esp_count
               WHERE esp_count.schedule_id = es.id) AS target_participant_count
       FROM exam_schedules es
       JOIN exam_revisions er ON er.id = es.exam_revision_id
       JOIN exams e ON e.id = er.exam_id
       WHERE ${where.join(" AND ")}
       ORDER BY es.id ASC LIMIT ?`,
      [...parameters, query.limit + 1],
    );
    return page(rows, query.limit, mapSchedule);
  }
}

interface ScopeColumns {
  readonly subjectColumn?: string;
  readonly classColumn?: string;
  readonly questionBankColumn?: string;
  readonly examColumn?: string;
  readonly scheduleColumn?: string;
  readonly academicYearColumn?: string;
  readonly ownerColumn?: string;
  readonly teacherSubjectColumn?: string;
  readonly teacherClassColumn?: string;
  readonly classExpression?: (ids: readonly Id[]) => string;
  readonly academicYearExpression?: (ids: readonly Id[]) => string;
}

function addScope(
  where: string[],
  parameters: unknown[],
  access: DiscoveryAccess,
  columns: ScopeColumns,
): void {
  if (access.ownerRole === "TEACHER") {
    if (columns.ownerColumn) {
      where.push(`${columns.ownerColumn} = ?`);
      parameters.push(access.ownerUserId);
    }
    if (columns.teacherSubjectColumn) {
      if (access.teacherSubjectIds.length === 0) {
        where.push("1 = 0");
      } else {
        where.push(
          `${columns.teacherSubjectColumn} IN (${placeholders(access.teacherSubjectIds.length)})`,
        );
        parameters.push(...access.teacherSubjectIds);
      }
    }
    if (columns.teacherClassColumn) {
      if (access.teacherClassIds.length === 0) {
        where.push("1 = 0");
      } else {
        where.push(
          `${columns.teacherClassColumn} IN (${placeholders(access.teacherClassIds.length)})`,
        );
        parameters.push(...access.teacherClassIds);
      }
    }
  }

  const grantClauses: string[] = [];
  for (const grant of access.grants) {
    if (grant.scopeType === "SCHOOL") {
      if (access.ownerRole === "ADMIN") grantClauses.push("1 = 1");
      continue;
    }
    if (grant.scopeType === "OWNER") {
      if (columns.ownerColumn && grant.scopeIds.includes(access.ownerUserId)) {
        grantClauses.push(`${columns.ownerColumn} = ?`);
        parameters.push(access.ownerUserId);
      }
      continue;
    }
    const expression = scopeExpression(columns, grant.scopeType);
    if (!expression || grant.scopeIds.length === 0) continue;
    grantClauses.push(expression(grant.scopeIds));
    parameters.push(...grant.scopeIds);
  }
  where.push(grantClauses.length ? `(${grantClauses.join(" OR ")})` : "1 = 0");
}

function scopeExpression(
  columns: ScopeColumns,
  type: IntegrationScopeType,
): ((ids: readonly Id[]) => string) | undefined {
  switch (type) {
    case "SUBJECT":
      return columns.subjectColumn
        ? (ids) => `${columns.subjectColumn} IN (${placeholders(ids.length)})`
        : undefined;
    case "CLASS":
      if (columns.classExpression) return columns.classExpression;
      return columns.classColumn
        ? (ids) => `${columns.classColumn} IN (${placeholders(ids.length)})`
        : undefined;
    case "QUESTION_BANK":
      return columns.questionBankColumn
        ? (ids) =>
            `${columns.questionBankColumn} IN (${placeholders(ids.length)})`
        : undefined;
    case "EXAM":
      return columns.examColumn
        ? (ids) => `${columns.examColumn} IN (${placeholders(ids.length)})`
        : undefined;
    case "SCHEDULE":
      return columns.scheduleColumn
        ? (ids) => `${columns.scheduleColumn} IN (${placeholders(ids.length)})`
        : undefined;
    case "ACADEMIC_YEAR":
      if (columns.academicYearExpression) return columns.academicYearExpression;
      return columns.academicYearColumn
        ? (ids) =>
            `${columns.academicYearColumn} IN (${placeholders(ids.length)})`
        : undefined;
    case "SCHOOL":
    case "OWNER":
      return undefined;
  }
}

function addTextSearch(
  where: string[],
  parameters: unknown[],
  value: string | undefined,
  columns: readonly string[],
): void {
  if (!value) return;
  const term = `%${value}%`;
  where.push(`(${columns.map((column) => `${column} LIKE ?`).join(" OR ")})`);
  parameters.push(...columns.map(() => term));
}

function addEquals(
  where: string[],
  parameters: unknown[],
  column: string,
  value: string,
): void {
  where.push(`${column} = ?`);
  parameters.push(value);
}

function addCursor(
  where: string[],
  parameters: unknown[],
  column: string,
  cursor: Id,
): void {
  where.push(`${column} > ?`);
  parameters.push(cursor);
}

function page<T>(
  rows: readonly Row[],
  limit: number,
  mapper: (row: Row) => T,
): DiscoveryPage<T> {
  const items = rows.slice(0, limit).map(mapper);
  return {
    items,
    nextCursor: rows.length > limit ? requiredId(rows[limit]?.id) : null,
  };
}

function mapSubject(row: Row): DiscoverySubject {
  return {
    id: requiredId(row.id),
    code: requiredString(row.code),
    name: requiredString(row.name),
    status: requiredString(row.status),
  };
}

function mapClass(row: Row): DiscoveryClass {
  return {
    id: requiredId(row.id),
    academicYearId: requiredId(row.academic_year_id),
    academicYearName: requiredString(row.academic_year_name),
    code: requiredString(row.code),
    name: requiredString(row.name),
    status: requiredString(row.status),
  };
}

function mapQuestionBank(row: Row): DiscoveryQuestionBank {
  return {
    id: requiredId(row.id),
    subjectId: requiredId(row.subject_id),
    subjectCode: requiredString(row.subject_code),
    subjectName: requiredString(row.subject_name),
    ownerTeacherId: requiredId(row.owner_teacher_id),
    name: requiredString(row.name),
    status: requiredString(row.status),
  };
}

function mapQuestion(row: Row): DiscoveryQuestion {
  return {
    id: requiredId(row.id),
    questionId: requiredId(row.question_id),
    questionBankId: requiredId(row.question_bank_id),
    subjectId: requiredId(row.subject_id),
    ownerTeacherId: requiredId(row.owner_teacher_id),
    bankName: requiredString(row.bank_name),
    type: requiredString(row.type),
    revisionNo: positiveInteger(row.revision_no),
    status: requiredString(row.status),
    questionStatus: requiredString(row.question_status),
    label: plainLabel(row.label),
    updatedAt: requiredTimestamp(row.updated_at),
  };
}

function mapExam(row: Row): DiscoveryExam {
  return {
    id: requiredId(row.id),
    subjectId: requiredId(row.subject_id),
    ownerTeacherId: requiredId(row.owner_teacher_id),
    status: requiredString(row.status),
    latestRevisionId: nullableId(row.latest_revision_id),
    latestRevisionStatus: nullableString(row.latest_revision_status),
    title: nullableString(row.title),
    updatedAt: requiredTimestamp(row.updated_at),
  };
}

function mapSchedule(row: Row): DiscoverySchedule {
  return {
    id: requiredId(row.id),
    examId: requiredId(row.exam_id),
    examRevisionId: requiredId(row.exam_revision_id),
    subjectId: requiredId(row.subject_id),
    ownerTeacherId: requiredId(row.owner_teacher_id),
    examTitle: requiredString(row.exam_title),
    mode: requiredString(row.mode),
    status: requiredString(row.status),
    startsAt: requiredTimestamp(row.starts_at),
    endsAt: requiredTimestamp(row.ends_at),
    durationSeconds: positiveInteger(row.duration_seconds),
    resultReleasePolicy: requiredString(row.result_release_policy),
    targetClassCount: nonNegativeInteger(row.target_class_count),
    targetParticipantCount: nonNegativeInteger(row.target_participant_count),
  };
}

function requiredId(value: unknown): Id {
  if (typeof value === "bigint") return formatId(value);
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
    return formatId(BigInt(value));
  const parsed = parseId(value);
  if (parsed) return parsed;
  throw new Error("Database returned an invalid discovery ID");
}

function nullableId(value: unknown): Id | null {
  return value === null || value === undefined ? null : requiredId(value);
}

function requiredString(value: unknown): string {
  if (typeof value !== "string")
    throw new Error("Database returned invalid discovery text");
  return value;
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : requiredString(value);
}

function positiveInteger(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < 1)
    throw new Error("Database returned invalid discovery integer");
  return number;
}

function nonNegativeInteger(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < 0)
    throw new Error("Database returned invalid discovery count");
  return number;
}

function requiredTimestamp(value: unknown): UtcTimestamp {
  if (value instanceof Date) return formatUtcTimestamp(value);
  if (typeof value === "string") {
    const parsed = parseUtcTimestamp(
      value.endsWith("Z") ? value : `${value.replace(" ", "T")}Z`,
    );
    if (parsed) return parsed;
  }
  throw new Error("Database returned invalid discovery timestamp");
}

function plainLabel(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]*>/gu, " ")
    .replace(/&nbsp;/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 240);
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}
