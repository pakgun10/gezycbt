import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  type BunSqlMigrationDatabase,
  createBunSqlMigrationDatabase,
  runMigrations,
} from "./index";
import { identityMigration } from "./migrations/0001_identity";
import { academicMigration } from "./migrations/0002_academic";
import { subjectsMigration } from "./migrations/0003_subjects";
import { systemLocksMigration } from "./migrations/0004_system_locks";
import { userImportPreviewsMigration } from "./migrations/0005_user_import_previews";
import { importCommitMigration } from "./migrations/0006_import_commit";
import { authThrottlesMigration } from "./migrations/0007_auth_throttles";
import { questionBanksMigration } from "./migrations/0008_question_banks";
import { questionOptionsMigration } from "./migrations/0009_question_options";
import { mediaMigration } from "./migrations/0010_media";
import { examsMigration } from "./migrations/0011_exams";
import { schedulesMigration } from "./migrations/0012_schedules";
import { examSessionsMigration } from "./migrations/0013_exam_sessions";
import { answersResultsMigration } from "./migrations/0014_answers_results";
import { attemptGrantsMigration } from "./migrations/0015_attempt_grants";

const databaseUrl = Bun.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
let database: BunSqlMigrationDatabase;

integration("migration runner with MariaDB", () => {
  beforeAll(async () => {
    if (!databaseUrl || new URL(databaseUrl).pathname !== "/gezycbt_test") {
      throw new Error(
        "Integration tests require the dedicated gezycbt_test database",
      );
    }
    database = createBunSqlMigrationDatabase(databaseUrl);
    await database.execute("DROP TABLE IF EXISTS migration_runner_test");
    await database.execute("DROP TABLE IF EXISTS schema_migrations");
  });

  afterAll(async () => {
    // exams <-> exam_revisions has a deliberate pointer cycle. Disable FK
    // checks only for disposable test cleanup; production migrations never do.
    await database.execute("SET FOREIGN_KEY_CHECKS = 0");
    await database.execute("DROP TABLE IF EXISTS audit_logs");
    await database.execute("DROP TABLE IF EXISTS exam_attempt_grants");
    await database.execute("DROP TABLE IF EXISTS exam_results");
    await database.execute("DROP TABLE IF EXISTS answers");
    await database.execute("DROP TABLE IF EXISTS exam_session_questions");
    await database.execute("DROP TABLE IF EXISTS exam_sessions");
    await database.execute("DROP TABLE IF EXISTS exam_schedule_participants");
    await database.execute("DROP TABLE IF EXISTS exam_schedule_classes");
    await database.execute("DROP TABLE IF EXISTS exam_schedules");
    await database.execute("DROP TABLE IF EXISTS question_revision_media");
    await database.execute("DROP TABLE IF EXISTS media_assets");
    await database.execute("DROP TABLE IF EXISTS exam_questions");
    await database.execute("DROP TABLE IF EXISTS exams");
    await database.execute("DROP TABLE IF EXISTS exam_revisions");
    await database.execute("DROP TABLE IF EXISTS auth_throttles");
    await database.execute("DROP TABLE IF EXISTS true_false_statements");
    await database.execute("DROP TABLE IF EXISTS question_options");
    await database.execute("DROP TABLE IF EXISTS question_revisions");
    await database.execute("DROP TABLE IF EXISTS questions");
    await database.execute("DROP TABLE IF EXISTS question_banks");
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
    await database.execute("DROP TABLE IF EXISTS migration_runner_test");
    await database.execute("DROP TABLE IF EXISTS schema_migrations");
    await database.execute("SET FOREIGN_KEY_CHECKS = 1");
    await database.close();
  });

  test("migrates an empty database and preserves an upgraded database", async () => {
    const migrations = [
      {
        id: "0001_create_test_table",
        statements: ["CREATE TABLE migration_runner_test (id INT PRIMARY KEY)"],
      },
      {
        id: "0002_add_test_value",
        statements: [
          "ALTER TABLE migration_runner_test ADD value VARCHAR(20) NULL",
        ],
      },
    ];
    const options = {
      lockName: "gezycbt:test:migrate",
      lockTimeoutSeconds: 1,
      release: "test",
    };
    await runMigrations(database, migrations, options);
    const first = await database.query<{ count: number | bigint }>(
      "SELECT COUNT(*) AS count FROM schema_migrations",
    );
    expect(Number(first[0]?.count)).toBe(2);
    await runMigrations(database, migrations, options);
    const second = await database.query<{ count: number | bigint }>(
      "SELECT COUNT(*) AS count FROM schema_migrations",
    );
    expect(Number(second[0]?.count)).toBe(2);

    await database.execute("DROP TABLE migration_runner_test");
    await database.execute("DROP TABLE schema_migrations");
    await runMigrations(
      database,
      [
        identityMigration,
        academicMigration,
        subjectsMigration,
        systemLocksMigration,
        userImportPreviewsMigration,
        importCommitMigration,
        authThrottlesMigration,
        questionBanksMigration,
        questionOptionsMigration,
        mediaMigration,
        examsMigration,
        schedulesMigration,
        examSessionsMigration,
        answersResultsMigration,
        attemptGrantsMigration,
      ],
      options,
    );
    const tables = await database.query<{ table_name: string }>(
      "SELECT TABLE_NAME AS table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN ('school_settings', 'users', 'auth_sessions')",
    );
    expect(tables.map((row) => row.table_name).sort()).toEqual([
      "auth_sessions",
      "school_settings",
      "users",
    ]);
    const academicTables = await database.query<{ table_name: string }>(
      "SELECT TABLE_NAME AS table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN ('academic_years', 'classes', 'class_members')",
    );
    expect(academicTables.map((row) => row.table_name).sort()).toEqual([
      "academic_years",
      "class_members",
      "classes",
    ]);
    const subjectTables = await database.query<{ table_name: string }>(
      "SELECT TABLE_NAME AS table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN ('subjects', 'teacher_subjects', 'teacher_classes')",
    );
    expect(subjectTables.map((row) => row.table_name).sort()).toEqual([
      "subjects",
      "teacher_classes",
      "teacher_subjects",
    ]);
    const lockTables = await database.query<{ table_name: string }>(
      "SELECT TABLE_NAME AS table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'system_locks'",
    );
    expect(lockTables.map((row) => row.table_name)).toEqual(["system_locks"]);
    const importTables = await database.query<{ table_name: string }>(
      "SELECT TABLE_NAME AS table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN ('user_import_previews', 'user_import_preview_rows')",
    );
    expect(importTables.map((row) => row.table_name).sort()).toEqual([
      "user_import_preview_rows",
      "user_import_previews",
    ]);
    const commitTables = await database.query<{ table_name: string }>(
      "SELECT TABLE_NAME AS table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN ('audit_logs', 'user_import_credential_artifacts')",
    );
    expect(commitTables.map((row) => row.table_name).sort()).toEqual([
      "audit_logs",
      "user_import_credential_artifacts",
    ]);
    const throttleTables = await database.query<{ table_name: string }>(
      "SELECT TABLE_NAME AS table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'auth_throttles'",
    );
    expect(throttleTables.map((row) => row.table_name)).toEqual([
      "auth_throttles",
    ]);
    const questionTables = await database.query<{ table_name: string }>(
      "SELECT TABLE_NAME AS table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN ('question_banks', 'questions', 'question_revisions')",
    );
    expect(questionTables.map((row) => row.table_name).sort()).toEqual([
      "question_banks",
      "question_revisions",
      "questions",
    ]);
    const optionTables = await database.query<{ table_name: string }>(
      "SELECT TABLE_NAME AS table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN ('question_options', 'true_false_statements')",
    );
    expect(optionTables.map((row) => row.table_name).sort()).toEqual([
      "question_options",
      "true_false_statements",
    ]);
    const mediaTables = await database.query<{ table_name: string }>(
      "SELECT TABLE_NAME AS table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN ('media_assets', 'question_revision_media')",
    );
    expect(mediaTables.map((row) => row.table_name).sort()).toEqual([
      "media_assets",
      "question_revision_media",
    ]);
    const examTables = await database.query<{ table_name: string }>(
      "SELECT TABLE_NAME AS table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN ('exams', 'exam_revisions', 'exam_questions')",
    );
    expect(examTables.map((row) => row.table_name).sort()).toEqual([
      "exam_questions",
      "exam_revisions",
      "exams",
    ]);
    const scheduleTables = await database.query<{ table_name: string }>(
      "SELECT TABLE_NAME AS table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN ('exam_schedules', 'exam_schedule_classes', 'exam_schedule_participants')",
    );
    expect(scheduleTables.map((row) => row.table_name).sort()).toEqual([
      "exam_schedule_classes",
      "exam_schedule_participants",
      "exam_schedules",
    ]);
    const runtimeTables = await database.query<{ table_name: string }>(
      "SELECT TABLE_NAME AS table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN ('exam_sessions', 'exam_session_questions', 'answers', 'exam_results', 'exam_attempt_grants')",
    );
    expect(runtimeTables.map((row) => row.table_name).sort()).toEqual([
      "answers",
      "exam_attempt_grants",
      "exam_results",
      "exam_session_questions",
      "exam_sessions",
    ]);
  });
});
