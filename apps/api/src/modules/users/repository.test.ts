import { describe, expect, test } from "bun:test";
import type { Id } from "@gezycbt/contracts";
import {
  SqlUserRepository,
  type UserRepositoryConnection,
  type UserRepositoryDatabase,
} from "./repository";

const row = {
  id: 10n,
  username: "Teacher.One",
  username_normalized: "teacher.one",
  password_hash: "$argon2id$v=19$m=19456,t=2,p=1$hash",
  role: "TEACHER",
  status: "ACTIVE",
  display_name: "Teacher One",
  force_password_change: 0,
  password_changed_at: null,
  last_login_at: null,
  created_at: "2026-09-17 01:00:00.000000",
  updated_at: "2026-09-17 01:00:00.000000",
};

function database(bootstrap = false): UserRepositoryDatabase & {
  readonly statements: string[];
} {
  const statements: string[] = [];
  let inserted = false;
  const connection: UserRepositoryConnection = {
    async query<T extends Record<string, unknown>>(sql: string) {
      statements.push(sql);
      if (sql.includes("FROM system_locks"))
        return [{ lock_name: "ADMIN_BOOTSTRAP" }] as unknown as readonly T[];
      if (sql.includes("WHERE role = 'ADMIN'"))
        return (bootstrap ? [] : [row]) as unknown as readonly T[];
      const rows = sql.includes("WHERE username_normalized")
        ? inserted
          ? [row]
          : []
        : [row];
      return rows as unknown as readonly T[];
    },
    async execute(sql) {
      statements.push(sql);
      if (sql.startsWith("INSERT INTO users")) inserted = true;
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

describe("SqlUserRepository", () => {
  test("creates a normalized user in a transaction and reads it back", async () => {
    const db = database();
    const repository = new SqlUserRepository(db);
    const user = await repository.create({
      username: " Teacher.One ",
      displayName: "Teacher One",
      role: "TEACHER",
      passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$hash",
    });

    expect(user.id).toBe("10" as Id);
    expect(
      db.statements.some((statement) =>
        statement.startsWith("INSERT INTO users"),
      ),
    ).toBe(true);
    expect(
      db.statements.some((statement) =>
        statement.includes("DELETE FROM users"),
      ),
    ).toBe(false);
  });

  test("updates and disables using status updates, never hard delete", async () => {
    const db = database();
    const repository = new SqlUserRepository(db);
    await repository.update("10" as Id, { displayName: "Renamed" });
    await repository.disable("10" as Id);

    expect(
      db.statements.some((statement) => statement.includes("UPDATE users SET")),
    ).toBe(true);
    expect(
      db.statements.some((statement) =>
        statement.includes("status = 'DISABLED'"),
      ),
    ).toBe(true);
    expect(
      db.statements.every(
        (statement) => !statement.includes("DELETE FROM users"),
      ),
    ).toBe(true);
  });

  test("updates password metadata transactionally without exposing a delete path", async () => {
    const db = database();
    const repository = new SqlUserRepository(db);
    const user = await repository.updatePassword(
      "10" as Id,
      "$argon2id$v=19$m=19456,t=2,p=1$replacement-hash",
      true,
    );

    expect(user?.id).toBe("10" as Id);
    expect(
      db.statements.some((statement) =>
        statement.includes("password_changed_at = UTC_TIMESTAMP(6)"),
      ),
    ).toBe(true);
    expect(
      db.statements.every(
        (statement) => !statement.includes("DELETE FROM users"),
      ),
    ).toBe(true);
  });

  test("serializes first-admin creation on the system lock row", async () => {
    const db = database(true);
    const repository = new SqlUserRepository(db);
    const user = await repository.createFirstAdmin({
      username: "admin",
      displayName: "Administrator",
      role: "ADMIN",
      passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$hash",
      forcePasswordChange: true,
    });

    expect(user.id).toBe("10" as Id);
    expect(
      db.statements.some((statement) =>
        statement.includes("FROM system_locks"),
      ),
    ).toBe(true);
  });
});
