import { describe, expect, test } from "bun:test";
import type { Id } from "@gezycbt/contracts";
import {
  type AcademicRepositoryConnection,
  type AcademicRepositoryDatabase,
  SqlAcademicRepository,
} from "./repository";

const yearRow = {
  id: 1n,
  name: "2026/2027",
  starts_on: "2026-07-01",
  ends_on: "2027-06-30",
  is_active: 1,
  created_at: "2026-09-17 01:00:00.000000",
  updated_at: "2026-09-17 01:00:00.000000",
};

function database(
  rowsByQuery: (sql: string) => readonly Record<string, unknown>[],
): AcademicRepositoryDatabase & {
  readonly statements: string[];
} {
  const statements: string[] = [];
  const connection: AcademicRepositoryConnection = {
    async query<T extends Record<string, unknown>>(sql: string) {
      statements.push(sql);
      return rowsByQuery(sql) as unknown as readonly T[];
    },
    async execute(sql) {
      statements.push(sql);
      return { affectedRows: 1 };
    },
  };
  return {
    statements,
    query: connection.query,
    execute: connection.execute,
    async transaction(operation) {
      return operation(connection);
    },
  };
}

describe("SqlAcademicRepository", () => {
  test("creates an active academic year transactionally", async () => {
    const db = database((sql) => {
      if (sql.includes("WHERE name = ?")) return [yearRow];
      return [];
    });
    const repository = new SqlAcademicRepository(db);
    const result = await repository.createAcademicYear({
      name: "2026/2027",
      startsOn: "2026-07-01",
      endsOn: "2027-06-30",
      isActive: true,
    });

    expect(result.id).toBe("1" as Id);
    expect(db.statements[0]).toContain(
      "UPDATE academic_years SET is_active = FALSE",
    );
    expect(
      db.statements.some((statement) =>
        statement.startsWith("INSERT INTO academic_years"),
      ),
    ).toBe(true);
  });

  test("uses bounded cursor pagination", async () => {
    const db = database(() => [
      { ...yearRow, id: 1n },
      { ...yearRow, id: 2n },
      { ...yearRow, id: 3n },
    ]);
    const repository = new SqlAcademicRepository(db);
    const result = await repository.listAcademicYears({ limit: 2 });

    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).toBe("2" as Id);
    expect(db.statements[0]).toContain("ORDER BY id ASC LIMIT ?");
  });

  test("replaces teacher scopes in one transaction and never returns raw SQL rows", async () => {
    const db = database((sql) => {
      if (sql.includes("FROM users")) return [{ id: 10n }];
      if (sql.includes("FROM subjects")) return [{ id: 20n }];
      if (sql.includes("FROM classes")) return [{ id: 30n }];
      return [];
    });
    const repository = new SqlAcademicRepository(db);
    const result = await repository.replaceTeacherScopes("10" as Id, {
      subjectIds: ["20" as Id],
      classIds: ["30" as Id],
    });

    expect(result).toEqual({
      teacherId: "10" as Id,
      subjectIds: ["20" as Id],
      classIds: ["30" as Id],
    });
    expect(
      db.statements.some((statement) =>
        statement.startsWith("DELETE FROM teacher_subjects"),
      ),
    ).toBe(true);
    expect(
      db.statements.some((statement) =>
        statement.startsWith("DELETE FROM teacher_classes"),
      ),
    ).toBe(true);
  });
});
