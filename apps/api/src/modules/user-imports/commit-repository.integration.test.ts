import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import type { DatabasePort } from "@gezycbt/database";
import {
  createBunSqlDatabase,
  createBunSqlMigrationDatabase,
  migrations,
  runMigrations,
} from "@gezycbt/database";
import {
  CredentialArtifactExpiredError,
  type ImportCommitDatabaseInput,
  SqlUserImportCommitRepository,
} from "./index";

const databaseUrl = Bun.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
let database: DatabasePort;

integration("user import commit repository with MariaDB", () => {
  beforeAll(async () => {
    if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
    const migrationDatabase = createBunSqlMigrationDatabase(databaseUrl);
    await runMigrations(migrationDatabase, migrations, {
      lockName: "gezycbt:test:import-commit",
      lockTimeoutSeconds: 1,
      release: "test",
    });
    await migrationDatabase.close();
    database = createBunSqlDatabase(databaseUrl);
  });

  afterAll(async () => {
    // The disposable schema now includes the exam pointer cycle and schedule
    // targets. Disable FK checks only for test cleanup; production never does.
    await database.execute("SET FOREIGN_KEY_CHECKS = 0");
    await database.execute("DROP TABLE IF EXISTS audit_logs");
    await database.execute("DROP TABLE IF EXISTS exam_schedule_participants");
    await database.execute("DROP TABLE IF EXISTS exam_schedule_classes");
    await database.execute("DROP TABLE IF EXISTS exam_schedules");
    await database.execute("DROP TABLE IF EXISTS exam_questions");
    await database.execute("DROP TABLE IF EXISTS exams");
    await database.execute("DROP TABLE IF EXISTS exam_revisions");
    await database.execute(
      "DROP TABLE IF EXISTS user_import_credential_artifacts",
    );
    await database.execute("DROP TABLE IF EXISTS user_import_preview_rows");
    await database.execute("DROP TABLE IF EXISTS user_import_previews");
    await database.execute("DROP TABLE IF EXISTS system_locks");
    await database.execute("DROP TABLE IF EXISTS teacher_classes");
    await database.execute("DROP TABLE IF EXISTS teacher_subjects");
    await database.execute("DROP TABLE IF EXISTS subjects");
    await database.execute("DROP TABLE IF EXISTS class_members");
    await database.execute("DROP TABLE IF EXISTS classes");
    await database.execute("DROP TABLE IF EXISTS academic_years");
    await database.execute("DROP TABLE IF EXISTS auth_sessions");
    await database.execute("DROP TABLE IF EXISTS users");
    await database.execute("DROP TABLE IF EXISTS school_settings");
    await database.execute("DROP TABLE IF EXISTS schema_migrations");
    await database.execute("SET FOREIGN_KEY_CHECKS = 1");
    await database.close();
  });

  test("commits atomically, replays by idempotency, and consumes artifact once", async () => {
    await database.execute(
      "INSERT INTO users (username, username_normalized, password_hash, role, display_name) VALUES (?, ?, ?, 'ADMIN', ?)",
      ["admin", "admin", "$argon2id$bootstrap", "Admin"],
    );
    const adminRows = await database.query<{ id: bigint }>(
      "SELECT id FROM users WHERE username_normalized = 'admin'",
    );
    const adminId = String(adminRows[0]?.id) as Id;
    await database.execute(
      "INSERT INTO academic_years (name, starts_on, ends_on, is_active) VALUES (?, ?, ?, TRUE)",
      ["2026/2027", "2026-07-01", "2027-06-30"],
    );
    const yearRows = await database.query<{ id: bigint }>(
      "SELECT id FROM academic_years LIMIT 1",
    );
    const yearId = String(yearRows[0]?.id) as Id;
    await database.execute(
      "INSERT INTO classes (academic_year_id, code, name) VALUES (?, ?, ?)",
      [yearId, "X-A", "Class X-A"],
    );
    const classRows = await database.query<{ id: bigint }>(
      "SELECT id FROM classes LIMIT 1",
    );
    const classId = String(classRows[0]?.id) as Id;
    const tokenHash = new Uint8Array(32).fill(1);
    const idempotencyHash = new Uint8Array(32).fill(2);
    await database.execute(
      "INSERT INTO user_import_previews (owner_user_id, academic_year_id, source_sha256, commit_token_hash, total_rows, create_count, expires_at) VALUES (?, ?, ?, ?, 1, 1, ?)",
      [
        adminId,
        yearId,
        new Uint8Array(32).fill(3),
        tokenHash,
        "2099-01-01 00:00:00",
      ],
    );
    const previewRows = await database.query<{ id: bigint }>(
      "SELECT id FROM user_import_previews LIMIT 1",
    );
    const previewId = String(previewRows[0]?.id) as Id;
    await database.execute(
      "INSERT INTO user_import_preview_rows (preview_id, `row_number`, username, display_name, class_code, class_id, classification, error_json) VALUES (?, 2, ?, ?, ?, ?, 'CREATE', ?)",
      [previewId, "participant-1", "Participant One", "X-A", classId, "[]"],
    );

    const repository = new SqlUserImportCommitRepository(database);
    const input: ImportCommitDatabaseInput = {
      ownerUserId: adminId,
      previewId,
      commitTokenHash: tokenHash,
      idempotencyHash,
      committedByUserId: adminId,
      requestId: "request-import-commit",
      artifactPayload: new TextEncoder().encode("encrypted"),
      artifactExpiresAt: "2099-01-01T00:15:00.000Z" as UtcTimestamp,
      credentials: [
        {
          rowNumber: 2,
          username: "participant-1",
          usernameNormalized: "participant-1",
          displayName: "Participant One",
          classId,
          passwordHash: "$argon2id$temporary",
        },
      ],
    };
    const first = await repository.commitPreview(input);
    const replay = await repository.commitPreview(input);
    expect(replay).toEqual(first);
    expect(first.createdUserCount).toBe(1);
    const users = await database.query<{ count: number | bigint }>(
      "SELECT COUNT(*) AS count FROM users WHERE role = 'PARTICIPANT'",
    );
    expect(Number(users[0]?.count)).toBe(1);
    const artifact = await repository.consumeCredentialArtifact(
      adminId,
      first.artifactId,
      adminId,
      "request-download",
    );
    expect(new TextDecoder().decode(artifact.encryptedPayload)).toBe(
      "encrypted",
    );
    expect(
      repository.consumeCredentialArtifact(
        adminId,
        first.artifactId,
        adminId,
        "request-download-2",
      ),
    ).rejects.toBeInstanceOf(CredentialArtifactExpiredError);
  });
});
