import { describe, expect, test } from "bun:test";
import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import type { DatabaseConnection, DatabasePort } from "@gezycbt/database";
import { ExamQuestionDuplicateError, ExamVersionConflictError } from "./domain";
import { SqlExamDraftRepository } from "./repository";

const NOW = "2026-09-17T02:00:00.000Z" as UtcTimestamp;
const NEXT = "2026-09-17T02:00:01.000Z" as UtcTimestamp;

describe("SqlExamDraftRepository", () => {
  test("creates an exam and its first draft revision atomically", async () => {
    const database = new FakeExamDatabase();
    const repository = new SqlExamDraftRepository(database);
    const revision = await repository.createExam({
      subjectId: "20" as Id,
      ownerTeacherId: "10" as Id,
      title: "Ujian",
      instructionsHtml: "Instruksi",
      durationSeconds: 3_600,
      shuffleQuestions: true,
      shuffleOptions: false,
    });

    expect(database.transactionCount).toBe(1);
    expect(revision.id).toBe("40" as Id);
    expect(revision.revisionNo).toBe(1);
    expect(revision.totalPoints).toBe("0.00");
    expect(database.statements[0]).toContain("INSERT INTO exams");
    expect(database.statements[1]).toContain("INSERT INTO exam_revisions");
  });

  test("adds a question using a temporary position range and rejects duplicate reference", async () => {
    const database = new FakeExamDatabase();
    database.questions = [questionRow(50n, 100n, 1), questionRow(51n, 101n, 2)];
    const repository = new SqlExamDraftRepository(database);

    const revision = await repository.addQuestion(
      "40" as Id,
      { questionRevisionId: "102" as Id, points: "1.5", position: 2 },
      NOW,
    );
    expect(revision?.questions.map((item) => item.questionRevisionId)).toEqual([
      "100" as Id,
      "102" as Id,
      "101" as Id,
    ]);
    expect(
      database.statements.some((sql) =>
        sql.includes("position = position + ?"),
      ),
    ).toBe(true);

    await expect(
      repository.addQuestion(
        "40" as Id,
        { questionRevisionId: "102" as Id, points: "1" },
        NOW,
      ),
    ).rejects.toBeInstanceOf(ExamQuestionDuplicateError);
  });

  test("checks the expected timestamp while the revision row is locked", async () => {
    const database = new FakeExamDatabase();
    const repository = new SqlExamDraftRepository(database);

    await expect(
      repository.updateRevision("40" as Id, { title: "Baru" }, NEXT),
    ).rejects.toBeInstanceOf(ExamVersionConflictError);
    expect(
      database.statements.some((sql) => sql.includes("SET title = ?")),
    ).toBe(false);
    expect(database.statements.some((sql) => sql.includes("FOR UPDATE"))).toBe(
      true,
    );
  });

  test("publishes the revision, stores total points, and advances the logical pointer", async () => {
    const database = new FakeExamDatabase();
    database.questions = [questionRow(50n, 100n, 1)];
    const repository = new SqlExamDraftRepository(database);

    const result = await repository.publishRevision("40" as Id, NOW, "1.00");

    expect(result?.status).toBe("PUBLISHED");
    expect(result?.totalPoints).toBe("1.00");
    expect(
      database.statements.some((sql) =>
        sql.includes("current_published_revision_id"),
      ),
    ).toBe(true);
  });
});

function questionRow(id: bigint, questionRevisionId: bigint, position: number) {
  return {
    id,
    exam_revision_id: 40n,
    question_revision_id: questionRevisionId,
    position,
    points: "1.00",
    created_at: NOW,
  };
}

class FakeExamDatabase implements DatabasePort {
  readonly statements: string[] = [];
  transactionCount = 0;
  questions: Record<string, unknown>[] = [];
  revisionStatus: "DRAFT" | "PUBLISHED" = "DRAFT";
  totalPoints = "0.00";

  async query<T extends Record<string, unknown>>(
    sql: string,
    parameters: readonly unknown[] = [],
  ): Promise<readonly T[]> {
    this.statements.push(sql);
    if (sql.includes("SELECT qb.subject_id, qr.status")) {
      return this.questions.map(() => ({
        subject_id: 20n,
        status: "PUBLISHED",
      })) as unknown as T[];
    }
    if (sql.includes("FROM exam_questions")) {
      return [...this.questions].sort(
        (a, b) => Number(a.position) - Number(b.position),
      ) as T[];
    }
    if (sql.includes("FROM question_revisions qr")) {
      return [
        {
          id: parameters[0] === "102" ? 102n : 100n,
          question_id: parameters[0] === "102" ? 1002n : 1000n,
          subject_id: 20n,
          owner_teacher_id: 10n,
          status: "PUBLISHED",
        },
      ] as unknown as T[];
    }
    if (sql.includes("SELECT revision_no FROM exam_revisions"))
      return [{ revision_no: 1 }] as unknown as T[];
    if (sql.includes("SELECT id FROM exam_revisions"))
      return [{ id: 40n }] as unknown as T[];
    if (sql.includes("FROM exam_revisions er"))
      return [
        revisionRow(this.revisionStatus, this.totalPoints),
      ] as unknown as T[];
    if (sql.includes("FROM exams"))
      return [examRow(this.revisionStatus)] as unknown as T[];
    return [] as T[];
  }

  async execute(
    sql: string,
    parameters: readonly unknown[] = [],
  ): Promise<{ affectedRows: number; insertId?: bigint }> {
    this.statements.push(sql);
    if (sql.includes("INSERT INTO exams"))
      return { affectedRows: 1, insertId: 30n };
    if (sql.includes("INSERT INTO exam_revisions"))
      return { affectedRows: 1, insertId: 40n };
    if (sql.includes("UPDATE exam_revisions")) {
      this.totalPoints = String(parameters[0]);
      this.revisionStatus = "PUBLISHED";
      return { affectedRows: 1 };
    }
    if (sql.includes("INSERT INTO exam_questions")) {
      this.questions.push({
        ...questionRow(
          52n,
          BigInt(String(parameters[1])),
          Number(parameters[2]),
        ),
        points: parameters[3],
      });
      return { affectedRows: 1, insertId: 52n };
    }
    if (sql.includes("SET position = position + ?")) {
      const offset = Number(parameters[0]);
      for (const row of this.questions)
        row.position = Number(row.position) + offset;
    }
    if (sql.includes("SET position = ? WHERE id = ?")) {
      const row = this.questions.find((item) => item.id === parameters[1]);
      if (row) row.position = parameters[0];
    }
    return { affectedRows: 1 };
  }

  async transaction<T>(
    operation: (connection: DatabaseConnection) => Promise<T>,
  ): Promise<T> {
    this.transactionCount += 1;
    return operation(this);
  }

  async close(): Promise<void> {}
}

function examRow(status: "DRAFT" | "PUBLISHED"): Record<string, unknown> {
  return {
    id: 30n,
    subject_id: 20n,
    owner_teacher_id: 10n,
    status,
    current_published_revision_id: status === "PUBLISHED" ? 40n : null,
    created_at: NOW,
    updated_at: NOW,
  };
}

function revisionRow(
  status: "DRAFT" | "PUBLISHED",
  totalPoints = "0.00",
): Record<string, unknown> {
  return {
    id: 40n,
    exam_id: 30n,
    subject_id: 20n,
    owner_teacher_id: 10n,
    exam_status: status,
    current_published_revision_id: status === "PUBLISHED" ? 40n : null,
    exam_created_at: NOW,
    exam_updated_at: NOW,
    revision_no: 1,
    status,
    title: "Ujian",
    instructions_html: "",
    duration_seconds: 3_600,
    shuffle_questions: 0,
    shuffle_options: 0,
    total_points: totalPoints,
    published_at: status === "PUBLISHED" ? NOW : null,
    created_at: NOW,
    updated_at: NOW,
  };
}
