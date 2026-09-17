import { describe, expect, test } from "bun:test";
import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import type { DatabaseConnection, DatabasePort } from "@gezycbt/database";
import type { QuestionDraftContent } from "./domain";
import { QuestionImmutableError, QuestionVersionConflictError } from "./domain";
import { SqlQuestionDraftRepository } from "./repository";

const NOW = "2026-09-17T01:00:00.000Z" as UtcTimestamp;

describe("SqlQuestionDraftRepository publish persistence", () => {
  test("publishes a draft in a transaction and reads the frozen revision", async () => {
    const db = new FakeQuestionDatabase("DRAFT");
    const repository = new SqlQuestionDraftRepository(db);

    const result = await repository.publishRevision("40" as Id, NOW);

    expect(result?.status).toBe("PUBLISHED");
    expect(result?.publishedAt).toBe(NOW);
    expect(db.transactionCount).toBe(1);
    expect(
      db.statements.some(
        (sql) =>
          sql.includes("SET status = 'PUBLISHED'") &&
          sql.includes("published_at = UTC_TIMESTAMP(6)"),
      ),
    ).toBe(true);
  });

  test("rejects stale expectedUpdatedAt before issuing a mutation", async () => {
    const db = new FakeQuestionDatabase("DRAFT");
    const repository = new SqlQuestionDraftRepository(db);

    await expect(
      repository.publishRevision(
        "40" as Id,
        "2026-09-17T00:59:00.000Z" as UtcTimestamp,
      ),
    ).rejects.toBeInstanceOf(QuestionVersionConflictError);
    expect(
      db.statements.some((sql) => sql.includes("SET status = 'PUBLISHED'")),
    ).toBe(false);
  });

  test("does not mutate a published revision", async () => {
    const db = new FakeQuestionDatabase("PUBLISHED");
    const repository = new SqlQuestionDraftRepository(db);

    await expect(
      repository.publishRevision("40" as Id, NOW),
    ).rejects.toBeInstanceOf(QuestionImmutableError);
    expect(
      db.statements.some((sql) => sql.includes("SET status = 'PUBLISHED'")),
    ).toBe(false);
  });

  test("creates the next draft revision without changing the published source", async () => {
    const db = new FakeQuestionDatabase("PUBLISHED");
    const repository = new SqlQuestionDraftRepository(db);

    const result = await repository.createDraftRevision(
      "40" as Id,
      {
        ...choiceContent(),
        contentHash: new Uint8Array(32),
      },
      NOW,
    );

    expect(result?.status).toBe("DRAFT");
    expect(result?.revisionNo).toBe(2);
    expect(result?.id).toBe("99" as Id);
    expect(
      db.statements.some((sql) =>
        sql.includes("INSERT INTO question_revisions"),
      ),
    ).toBe(true);
  });
});

function choiceContent(): QuestionDraftContent {
  return {
    type: "SINGLE_CHOICE",
    stimulusHtml: "Stimulus",
    promptHtml: "Prompt",
    explanationHtml: null,
    options: [
      { position: 1, contentHtml: "A", isCorrect: true },
      { position: 2, contentHtml: "B", isCorrect: false },
    ],
    statements: [],
  };
}

class FakeQuestionDatabase implements DatabasePort {
  readonly statements: string[] = [];
  transactionCount = 0;
  private revisionStatus: "DRAFT" | "PUBLISHED";

  constructor(status: "DRAFT" | "PUBLISHED") {
    this.revisionStatus = status;
  }

  async query<T extends Record<string, unknown>>(
    sql: string,
    parameters: readonly unknown[] = [],
  ): Promise<readonly T[]> {
    this.statements.push(sql);
    if (sql.includes("FROM question_options")) {
      return [
        { id: 101n, position: 1, content_html: "A", is_correct: 1 },
        { id: 102n, position: 2, content_html: "B", is_correct: 0 },
      ] as unknown as readonly T[];
    }
    if (sql.includes("FROM true_false_statements")) {
      return [] as readonly T[];
    }
    if (sql.includes("SELECT revision_no")) {
      return [{ revision_no: 1 }] as unknown as readonly T[];
    }
    if (sql.includes("FROM question_revisions qr")) {
      const id = parameters[0] === "99" ? 99n : 40n;
      return [this.revisionRow(id)] as unknown as readonly T[];
    }
    return [] as readonly T[];
  }

  async execute(
    sql: string,
  ): Promise<{ affectedRows: number; insertId?: bigint }> {
    this.statements.push(sql);
    if (sql.includes("SET status = 'PUBLISHED'")) {
      this.revisionStatus = "PUBLISHED";
      return { affectedRows: 1 };
    }
    if (sql.includes("INSERT INTO question_revisions")) {
      return { affectedRows: 1, insertId: 99n };
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

  private revisionRow(id: bigint): Record<string, unknown> {
    const status = id === 99n ? "DRAFT" : this.revisionStatus;
    return {
      id,
      question_id: 41n,
      question_bank_id: 20n,
      subject_id: 30n,
      owner_teacher_id: 10n,
      bank_name: "Bank",
      bank_status: "ACTIVE",
      question_status: "ACTIVE",
      revision_no: id === 99n ? 2 : 1,
      type: "SINGLE_CHOICE",
      status,
      stimulus_html: "Stimulus",
      prompt_html: "Prompt",
      explanation_html: null,
      content_hash: new Uint8Array(32),
      published_at: status === "PUBLISHED" ? NOW : null,
      created_at: NOW,
      updated_at: NOW,
    };
  }
}
