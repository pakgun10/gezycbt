import { describe, expect, test } from "bun:test";
import { type MigrationDatabase, runMigrations } from "./migration-runner";

function fakeDatabase(): MigrationDatabase & {
  readonly executed: string[];
  locked: boolean;
} {
  const applied = new Map<string, string>();
  const executed: string[] = [];
  return {
    executed,
    locked: false,
    async query(sql, _parameters) {
      if (sql.startsWith("SELECT GET_LOCK")) return [{ acquired: 1 }] as never;
      if (sql.startsWith("SELECT RELEASE_LOCK"))
        return [{ released: 1 }] as never;
      if (sql.startsWith("SELECT id, checksum"))
        return [...applied].map(([id, checksum]) => ({
          id,
          checksum,
        })) as never;
      return [] as never;
    },
    async execute(sql, parameters) {
      executed.push(sql);
      if (sql.startsWith("INSERT INTO schema_migrations"))
        applied.set(parameters?.[0] as string, parameters?.[1] as string);
    },
  };
}

describe("migration runner", () => {
  test("applies each migration once and records a checksum", async () => {
    const database = fakeDatabase();
    const migrations = [
      {
        id: "0001_schema_migrations",
        statements: ["CREATE TABLE example (id INT)"],
      },
    ];
    await runMigrations(database, migrations, {
      lockName: "gezycbt:migrate",
      lockTimeoutSeconds: 1,
      release: "test",
    });
    const countAfterFirstRun = database.executed.length;
    await runMigrations(database, migrations, {
      lockName: "gezycbt:migrate",
      lockTimeoutSeconds: 1,
      release: "test",
    });
    expect(database.executed.length).toBe(countAfterFirstRun + 1);
  });

  test("rejects a changed checksum for an applied migration", async () => {
    const database = fakeDatabase();
    await runMigrations(
      database,
      [
        {
          id: "0001_schema_migrations",
          statements: ["CREATE TABLE one (id INT)"],
        },
      ],
      { lockName: "gezycbt:migrate", lockTimeoutSeconds: 1, release: "test" },
    );
    expect(
      runMigrations(
        database,
        [
          {
            id: "0001_schema_migrations",
            statements: ["CREATE TABLE two (id INT)"],
          },
        ],
        { lockName: "gezycbt:migrate", lockTimeoutSeconds: 1, release: "test" },
      ),
    ).rejects.toThrow("checksum changed");
  });
});
