import { describe, expect, test } from "bun:test";
import type { Id } from "@gezycbt/contracts";
import type { DatabaseConnection, DatabasePort } from "@gezycbt/database";
import { SqlQuestionDraftRepository } from "./repository";

describe("SqlQuestionDraftRepository", () => {
  test("qualifies placement timestamps when listing media", async () => {
    const database = new FakeQuestionDatabase();
    const repository = new SqlQuestionDraftRepository(database);

    await repository.listMedia("7" as Id);

    expect(database.statements[0]).toContain("p.updated_at AS updated_at");
  });
});

class FakeQuestionDatabase implements DatabasePort {
  readonly statements: string[] = [];

  async query<T extends Record<string, unknown>>(
    sql: string,
    _parameters: readonly unknown[] = [],
  ): Promise<readonly T[]> {
    this.statements.push(sql);
    return [];
  }

  async execute(
    _sql: string,
    _parameters: readonly unknown[] = [],
  ): Promise<{ affectedRows: number; insertId?: bigint }> {
    return { affectedRows: 0 };
  }

  async transaction<T>(
    operation: (connection: DatabaseConnection) => Promise<T>,
  ): Promise<T> {
    return operation(this);
  }

  async close(): Promise<void> {}
}
