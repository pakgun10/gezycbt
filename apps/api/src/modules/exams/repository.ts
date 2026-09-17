import {
  formatId,
  formatUtcTimestamp,
  type Id,
  parseId,
  parseUtcTimestamp,
  type UtcTimestamp,
} from "@gezycbt/contracts";
import type { DatabasePort } from "@gezycbt/database";
import {
  type AddExamQuestionInput,
  type CreateExamInput,
  type ExamDraftMetadata,
  ExamImmutableError,
  type ExamQuestion,
  ExamQuestionDuplicateError,
  ExamQuestionOrderError,
  type ExamQuestionReference,
  type ExamRevision,
  type ExamStatus,
  type ExamSummary,
  ExamValidationError,
  ExamVersionConflictError,
  normalizePoints,
  type UpdateExamRevisionInput,
  validatePosition,
} from "./domain";

export interface ExamRepositoryConnection {
  query<T extends Record<string, unknown>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<readonly T[]>;
  execute(sql: string, parameters?: readonly unknown[]): Promise<unknown>;
}

export interface ExamDraftRepository {
  findExam(id: Id): Promise<ExamSummary | null>;
  findRevision(id: Id): Promise<ExamRevision | null>;
  findLatestRevision(examId: Id): Promise<ExamRevision | null>;
  findQuestionRevision(id: Id): Promise<ExamQuestionReference | null>;
  createExam(input: CreateExamInput): Promise<ExamRevision>;
  createDraftRevision(
    examId: Id,
    input: ExamDraftMetadata,
  ): Promise<ExamRevision | null>;
  updateRevision(
    id: Id,
    input: UpdateExamRevisionInput,
    expectedUpdatedAt: UtcTimestamp,
  ): Promise<ExamRevision | null>;
  addQuestion(
    revisionId: Id,
    input: AddExamQuestionInput,
    expectedUpdatedAt: UtcTimestamp,
  ): Promise<ExamRevision | null>;
  removeQuestion(
    revisionId: Id,
    questionRevisionId: Id,
    expectedUpdatedAt: UtcTimestamp,
  ): Promise<ExamRevision | null>;
  reorderQuestions(
    revisionId: Id,
    orderedQuestionRevisionIds: readonly Id[],
    expectedUpdatedAt: UtcTimestamp,
  ): Promise<ExamRevision | null>;
}

type ExamRow = Record<string, unknown> & {
  id: unknown;
  subject_id: unknown;
  owner_teacher_id: unknown;
  status: unknown;
  current_published_revision_id: unknown;
  created_at: unknown;
  updated_at: unknown;
};

type RevisionRow = Record<string, unknown> & {
  id: unknown;
  exam_id: unknown;
  subject_id: unknown;
  owner_teacher_id: unknown;
  exam_status: unknown;
  current_published_revision_id: unknown;
  exam_created_at: unknown;
  exam_updated_at: unknown;
  revision_no: unknown;
  status: unknown;
  title: unknown;
  instructions_html: unknown;
  duration_seconds: unknown;
  shuffle_questions: unknown;
  shuffle_options: unknown;
  total_points: unknown;
  published_at: unknown;
  created_at: unknown;
  updated_at: unknown;
};

type QuestionRow = Record<string, unknown> & {
  id: unknown;
  exam_revision_id: unknown;
  question_revision_id: unknown;
  position: unknown;
  points: unknown;
  created_at: unknown;
};

type QuestionReferenceRow = Record<string, unknown> & {
  id: unknown;
  question_id: unknown;
  subject_id: unknown;
  owner_teacher_id: unknown;
  status: unknown;
};

const REVISION_COLUMNS = `
  SELECT er.id, er.exam_id, e.subject_id, e.owner_teacher_id,
         e.status AS exam_status, e.current_published_revision_id,
         e.created_at AS exam_created_at, e.updated_at AS exam_updated_at,
         er.revision_no, er.status, er.title, er.instructions_html,
         er.duration_seconds, er.shuffle_questions, er.shuffle_options,
         er.total_points, er.published_at, er.created_at, er.updated_at
  FROM exam_revisions er
  JOIN exams e ON e.id = er.exam_id`;

export class SqlExamDraftRepository implements ExamDraftRepository {
  constructor(private readonly database: DatabasePort) {}

  async findExam(id: Id): Promise<ExamSummary | null> {
    const rows = await this.database.query<ExamRow>(
      `SELECT id, subject_id, owner_teacher_id, status,
              current_published_revision_id, created_at, updated_at
       FROM exams WHERE id = ? LIMIT 1`,
      [id],
    );
    return rows[0] ? mapExam(rows[0]) : null;
  }

  findRevision(id: Id): Promise<ExamRevision | null> {
    return this.database.transaction((connection) =>
      readRevision(connection, id),
    );
  }

  findLatestRevision(examId: Id): Promise<ExamRevision | null> {
    return this.database.transaction((connection) =>
      readLatestRevision(connection, examId),
    );
  }

  async findQuestionRevision(id: Id): Promise<ExamQuestionReference | null> {
    const rows = await this.database.query<QuestionReferenceRow>(
      `SELECT qr.id, qr.question_id, qb.subject_id, qb.owner_teacher_id,
              qr.status
       FROM question_revisions qr
       JOIN questions q ON q.id = qr.question_id
       JOIN question_banks qb ON qb.id = q.question_bank_id
       WHERE qr.id = ? LIMIT 1`,
      [id],
    );
    return rows[0] ? mapQuestionReference(rows[0]) : null;
  }

  async createExam(input: CreateExamInput): Promise<ExamRevision> {
    return this.database.transaction(async (connection) => {
      const examResult = await connection.execute(
        `INSERT INTO exams (subject_id, owner_teacher_id, status)
         VALUES (?, ?, 'DRAFT')`,
        [input.subjectId, input.ownerTeacherId],
      );
      const examId = insertId(examResult, "Exam insert");
      const revisionResult = await connection.execute(
        `INSERT INTO exam_revisions
           (exam_id, revision_no, status, title, instructions_html,
            duration_seconds, shuffle_questions, shuffle_options, total_points)
         VALUES (?, 1, 'DRAFT', ?, ?, ?, ?, ?, 0.00)`,
        [
          examId,
          input.title,
          input.instructionsHtml,
          input.durationSeconds,
          input.shuffleQuestions,
          input.shuffleOptions,
        ],
      );
      const revisionId = insertId(revisionResult, "Exam revision insert");
      const revision = await readRevision(connection, revisionId);
      if (!revision) throw new Error("Created exam could not be read");
      return revision;
    });
  }

  async createDraftRevision(
    examId: Id,
    input: ExamDraftMetadata,
  ): Promise<ExamRevision | null> {
    return this.database.transaction(async (connection) => {
      const examRows = await connection.query<ExamRow>(
        `SELECT id, subject_id, owner_teacher_id, status,
                current_published_revision_id, created_at, updated_at
         FROM exams WHERE id = ? LIMIT 1 FOR UPDATE`,
        [examId],
      );
      if (!examRows[0]) return null;
      if (examRows[0].status === "ARCHIVED") throw new ExamImmutableError();
      const latest = await connection.query<{ revision_no: unknown }>(
        `SELECT revision_no FROM exam_revisions
         WHERE exam_id = ? ORDER BY revision_no DESC LIMIT 1 FOR UPDATE`,
        [examId],
      );
      const latestNo = Number(latest[0]?.revision_no ?? 0);
      if (!Number.isSafeInteger(latestNo) || latestNo < 0)
        throw new Error("Database returned invalid exam revision number");
      const result = await connection.execute(
        `INSERT INTO exam_revisions
           (exam_id, revision_no, status, title, instructions_html,
            duration_seconds, shuffle_questions, shuffle_options, total_points)
         VALUES (?, ?, 'DRAFT', ?, ?, ?, ?, ?, 0.00)`,
        [
          examId,
          latestNo + 1,
          input.title,
          input.instructionsHtml,
          input.durationSeconds,
          input.shuffleQuestions,
          input.shuffleOptions,
        ],
      );
      const revisionId = insertId(result, "Exam revision insert");
      return readRevision(connection, revisionId);
    });
  }

  async updateRevision(
    id: Id,
    input: UpdateExamRevisionInput,
    expectedUpdatedAt: UtcTimestamp,
  ): Promise<ExamRevision | null> {
    return this.database.transaction(async (connection) => {
      const current = await readRevision(connection, id, true);
      if (!current) return null;
      assertDraftAndVersion(current, expectedUpdatedAt);
      const assignments: string[] = [];
      const parameters: unknown[] = [];
      if (input.title !== undefined) {
        assignments.push("title = ?");
        parameters.push(input.title);
      }
      if (input.instructionsHtml !== undefined) {
        assignments.push("instructions_html = ?");
        parameters.push(input.instructionsHtml);
      }
      if (input.durationSeconds !== undefined) {
        assignments.push("duration_seconds = ?");
        parameters.push(input.durationSeconds);
      }
      if (input.shuffleQuestions !== undefined) {
        assignments.push("shuffle_questions = ?");
        parameters.push(input.shuffleQuestions);
      }
      if (input.shuffleOptions !== undefined) {
        assignments.push("shuffle_options = ?");
        parameters.push(input.shuffleOptions);
      }
      if (assignments.length === 0)
        throw new ExamValidationError(
          "At least one exam field must be updated",
        );
      await connection.execute(
        `UPDATE exam_revisions SET ${assignments.join(", ")},
           updated_at = UTC_TIMESTAMP(6)
         WHERE id = ? AND status = 'DRAFT'`,
        [...parameters, id],
      );
      return readRevision(connection, id);
    });
  }

  async addQuestion(
    revisionId: Id,
    input: AddExamQuestionInput,
    expectedUpdatedAt: UtcTimestamp,
  ): Promise<ExamRevision | null> {
    try {
      return await this.database.transaction(async (connection) => {
        const current = await readRevision(connection, revisionId, true);
        if (!current) return null;
        assertDraftAndVersion(current, expectedUpdatedAt);
        const existing = await readQuestionRows(connection, revisionId, true);
        if (
          existing.some(
            (row) =>
              parseDatabaseId(row.question_revision_id) ===
              input.questionRevisionId,
          )
        )
          throw new ExamQuestionDuplicateError();
        const position = input.position ?? existing.length + 1;
        validatePosition(position, existing.length + 1);
        await normalizeQuestionPositions(
          connection,
          revisionId,
          existing,
          undefined,
          position,
        );
        await connection.execute(
          `INSERT INTO exam_questions
             (exam_revision_id, question_revision_id, position, points)
           VALUES (?, ?, ?, ?)`,
          [
            revisionId,
            input.questionRevisionId,
            position,
            normalizePoints(input.points),
          ],
        );
        return readRevision(connection, revisionId);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ExamQuestionDuplicateError();
      throw error;
    }
  }

  async removeQuestion(
    revisionId: Id,
    questionRevisionId: Id,
    expectedUpdatedAt: UtcTimestamp,
  ): Promise<ExamRevision | null> {
    return this.database.transaction(async (connection) => {
      const current = await readRevision(connection, revisionId, true);
      if (!current) return null;
      assertDraftAndVersion(current, expectedUpdatedAt);
      const existing = await readQuestionRows(connection, revisionId, true);
      const target = existing.find(
        (row) =>
          parseDatabaseId(row.question_revision_id) === questionRevisionId,
      );
      if (!target) return null;
      await connection.execute(
        `DELETE FROM exam_questions
         WHERE exam_revision_id = ? AND question_revision_id = ?`,
        [revisionId, questionRevisionId],
      );
      await normalizeQuestionPositions(
        connection,
        revisionId,
        existing.filter((row) => row !== target),
      );
      return readRevision(connection, revisionId);
    });
  }

  async reorderQuestions(
    revisionId: Id,
    orderedQuestionRevisionIds: readonly Id[],
    expectedUpdatedAt: UtcTimestamp,
  ): Promise<ExamRevision | null> {
    return this.database.transaction(async (connection) => {
      const current = await readRevision(connection, revisionId, true);
      if (!current) return null;
      assertDraftAndVersion(current, expectedUpdatedAt);
      const existing = await readQuestionRows(connection, revisionId, true);
      const existingIds = existing.map((row) =>
        parseDatabaseId(row.question_revision_id),
      );
      if (
        orderedQuestionRevisionIds.length !== existingIds.length ||
        new Set(orderedQuestionRevisionIds).size !==
          orderedQuestionRevisionIds.length ||
        orderedQuestionRevisionIds.some((id) => !existingIds.includes(id))
      )
        throw new ExamQuestionOrderError();
      await normalizeQuestionPositions(
        connection,
        revisionId,
        existing,
        orderedQuestionRevisionIds,
      );
      return readRevision(connection, revisionId);
    });
  }
}

async function readRevision(
  connection: ExamRepositoryConnection,
  id: Id,
  lock = false,
): Promise<ExamRevision | null> {
  const rows = await connection.query<RevisionRow>(
    `${REVISION_COLUMNS} WHERE er.id = ? LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [id],
  );
  if (!rows[0]) return null;
  const questionRows = await readQuestionRows(connection, id, false);
  return mapRevision(rows[0], questionRows);
}

async function readLatestRevision(
  connection: ExamRepositoryConnection,
  examId: Id,
): Promise<ExamRevision | null> {
  const rows = await connection.query<{ id: unknown }>(
    `SELECT id FROM exam_revisions
     WHERE exam_id = ? ORDER BY revision_no DESC, id DESC LIMIT 1`,
    [examId],
  );
  const id = rows[0] ? parseDatabaseId(rows[0].id) : undefined;
  return id ? readRevision(connection, id) : null;
}

async function readQuestionRows(
  connection: ExamRepositoryConnection,
  revisionId: Id,
  lock: boolean,
): Promise<readonly QuestionRow[]> {
  return connection.query<QuestionRow>(
    `SELECT id, exam_revision_id, question_revision_id, position, points,
            created_at
     FROM exam_questions
     WHERE exam_revision_id = ?
     ORDER BY position ASC, id ASC${lock ? " FOR UPDATE" : ""}`,
    [revisionId],
  );
}

async function normalizeQuestionPositions(
  connection: ExamRepositoryConnection,
  revisionId: Id,
  rows: readonly QuestionRow[],
  orderedIds?: readonly Id[],
  insertPosition?: number,
): Promise<void> {
  if (rows.length === 0) return;
  // The unique (revision_id, position) key means a reorder must use a
  // temporary disjoint range before assigning final one-based positions.
  const offset = rows.length + 1_000_000;
  await connection.execute(
    `UPDATE exam_questions SET position = position + ?
     WHERE exam_revision_id = ?`,
    [offset, revisionId],
  );
  const byQuestion = new Map(
    rows.map((row) => [parseDatabaseId(row.question_revision_id), row]),
  );
  const ids =
    orderedIds ?? rows.map((row) => parseDatabaseId(row.question_revision_id));
  for (const [index, questionId] of ids.entries()) {
    const row = byQuestion.get(questionId);
    if (!row) throw new ExamQuestionOrderError();
    const position =
      insertPosition !== undefined && index + 1 >= insertPosition
        ? index + 2
        : index + 1;
    await connection.execute(
      `UPDATE exam_questions SET position = ? WHERE id = ?`,
      [position, row.id],
    );
  }
}

function assertDraftAndVersion(
  revision: ExamRevision,
  expectedUpdatedAt: UtcTimestamp,
): void {
  if (revision.status !== "DRAFT") throw new ExamImmutableError();
  if (revision.updatedAt !== expectedUpdatedAt)
    throw new ExamVersionConflictError();
}

function mapExam(row: ExamRow): ExamSummary {
  return {
    id: requiredId(row.id, "exam ID"),
    subjectId: requiredId(row.subject_id, "subject ID"),
    ownerTeacherId: requiredId(row.owner_teacher_id, "owner teacher ID"),
    status: requiredExamStatus(row.status),
    currentPublishedRevisionId: nullableId(row.current_published_revision_id),
    createdAt: requiredTimestamp(row.created_at),
    updatedAt: requiredTimestamp(row.updated_at),
  };
}

function mapRevision(
  row: RevisionRow,
  questionRows: readonly QuestionRow[],
): ExamRevision {
  const exam: ExamSummary = {
    id: requiredId(row.exam_id, "exam ID"),
    subjectId: requiredId(row.subject_id, "subject ID"),
    ownerTeacherId: requiredId(row.owner_teacher_id, "owner teacher ID"),
    status: requiredExamStatus(row.exam_status),
    currentPublishedRevisionId: nullableId(row.current_published_revision_id),
    createdAt: requiredTimestamp(row.exam_created_at),
    updatedAt: requiredTimestamp(row.exam_updated_at),
  };
  const revisionId = requiredId(row.id, "exam revision ID");
  const revisionNo = Number(row.revision_no);
  const durationSeconds = Number(row.duration_seconds);
  if (!Number.isSafeInteger(revisionNo) || revisionNo < 1)
    throw new Error("Database returned invalid exam revision number");
  if (!Number.isSafeInteger(durationSeconds) || durationSeconds < 1)
    throw new Error("Database returned invalid exam duration");
  if (row.status !== "DRAFT" && row.status !== "PUBLISHED")
    throw new Error("Database returned invalid exam revision status");
  return {
    id: revisionId,
    examId: exam.id,
    exam,
    revisionNo,
    status: row.status,
    title: requiredString(row.title, "exam title"),
    instructionsHtml: requiredString(row.instructions_html, "instructions"),
    durationSeconds,
    shuffleQuestions: toBoolean(row.shuffle_questions),
    shuffleOptions: toBoolean(row.shuffle_options),
    totalPoints: requiredDecimal(row.total_points, "total points", true),
    publishedAt: nullableTimestamp(row.published_at),
    questions: questionRows.map(mapQuestion),
    createdAt: requiredTimestamp(row.created_at),
    updatedAt: requiredTimestamp(row.updated_at),
  };
}

function mapQuestion(row: QuestionRow): ExamQuestion {
  const position = Number(row.position);
  if (!Number.isSafeInteger(position) || position < 1)
    throw new Error("Database returned invalid exam question position");
  return {
    id: requiredId(row.id, "exam question ID"),
    examRevisionId: requiredId(row.exam_revision_id, "exam revision ID"),
    questionRevisionId: requiredId(
      row.question_revision_id,
      "question revision ID",
    ),
    position,
    points: requiredDecimal(row.points, "question points"),
    createdAt: requiredTimestamp(row.created_at),
  };
}

function mapQuestionReference(
  row: QuestionReferenceRow,
): ExamQuestionReference {
  if (row.status !== "DRAFT" && row.status !== "PUBLISHED")
    throw new Error("Database returned invalid question revision status");
  return {
    id: requiredId(row.id, "question revision ID"),
    questionId: requiredId(row.question_id, "question ID"),
    subjectId: requiredId(row.subject_id, "subject ID"),
    ownerTeacherId: requiredId(row.owner_teacher_id, "owner teacher ID"),
    status: row.status,
  };
}

function requiredExamStatus(value: unknown): ExamStatus {
  if (value === "DRAFT" || value === "PUBLISHED" || value === "ARCHIVED")
    return value;
  throw new Error("Database returned invalid exam status");
}

function insertId(result: unknown, label: string): Id {
  const id = (result as { insertId?: unknown } | null)?.insertId;
  if (typeof id !== "bigint") throw new Error(`${label} did not return an ID`);
  return formatId(id);
}

function requiredId(value: unknown, field: string): Id {
  if (typeof value === "bigint") return formatId(value);
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
    return formatId(BigInt(value));
  const parsed = parseId(value);
  if (!parsed) throw new Error(`Database returned invalid ${field}`);
  return parsed;
}

function parseDatabaseId(value: unknown): Id {
  return requiredId(value, "ID");
}

function nullableId(value: unknown): Id | null {
  return value === null || value === undefined ? null : requiredId(value, "ID");
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string")
    throw new Error(`Database returned invalid ${field}`);
  return value;
}

function requiredDecimal(
  value: unknown,
  field: string,
  allowZero = false,
): string {
  if (typeof value === "number" && Number.isFinite(value))
    return normalizeDecimal(value.toFixed(2), field, allowZero);
  if (typeof value === "string") {
    return normalizeDecimal(value, field, allowZero);
  }
  throw new Error(`Database returned invalid ${field}`);
}

function normalizeDecimal(
  value: string,
  field: string,
  allowZero: boolean,
): string {
  if (!/^\d+(?:\.\d{1,2})?$/u.test(value))
    throw new Error(`Database returned invalid ${field}`);
  const [whole = "", fraction = ""] = value.split(".");
  const wholeNumber = BigInt(whole);
  if (wholeNumber > 99_999_999n)
    throw new Error(`Database returned invalid ${field}`);
  const normalized = `${wholeNumber}.${fraction.padEnd(2, "0")}`;
  if (!allowZero && normalized === "0.00")
    throw new Error(`Database returned invalid ${field}`);
  return normalized;
}

function requiredTimestamp(value: unknown): UtcTimestamp {
  if (value instanceof Date) return formatUtcTimestamp(value);
  if (typeof value === "string") {
    const parsed = parseUtcTimestamp(
      value.endsWith("Z") ? value : `${value.replace(" ", "T")}Z`,
    );
    if (parsed) return parsed;
  }
  throw new Error("Database returned invalid timestamp");
}

function nullableTimestamp(value: unknown): UtcTimestamp | null {
  return value === null || value === undefined
    ? null
    : requiredTimestamp(value);
}

function toBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: unknown; errno?: unknown } | null;
  const code = String(candidate?.code ?? candidate?.errno ?? "");
  return code === "ER_DUP_ENTRY" || code === "1062";
}
