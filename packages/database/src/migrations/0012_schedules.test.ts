import { describe, expect, test } from "bun:test";
import { schedulesMigration } from "./0012_schedules";
import { migrations } from "./index";

describe("schedules migration", () => {
  test("creates schedule policy and both target tables", () => {
    expect(schedulesMigration.id).toBe("0012_schedules");
    expect(schedulesMigration.statements).toHaveLength(3);
    expect(schedulesMigration.statements[0]).toContain(
      "CREATE TABLE exam_schedules",
    );
    expect(schedulesMigration.statements[0]).toContain(
      "exam_revision_id BIGINT UNSIGNED NOT NULL",
    );
    expect(schedulesMigration.statements[0]).toContain(
      "mode IN ('MAIN', 'PRACTICE')",
    );
    expect(schedulesMigration.statements[0]).toContain(
      "status IN ('DRAFT', 'READY', 'OPEN', 'CLOSED', 'ARCHIVED')",
    );
    expect(schedulesMigration.statements[0]).toContain(
      "practice_token_hash BINARY(32) NULL",
    );
    expect(schedulesMigration.statements[0]).toContain(
      "main_access_code_hash BINARY(32) NULL",
    );
    expect(schedulesMigration.statements[0]).toContain("max_attempts = 1");
    expect(schedulesMigration.statements[0]).toContain("hard_end = TRUE");
    expect(schedulesMigration.statements[0]).toContain(
      "UNIQUE (practice_token_hash)",
    );
    expect(schedulesMigration.statements[0]).toContain(
      "UNIQUE (main_access_code_hash)",
    );
    expect(schedulesMigration.statements[1]).toContain(
      "CREATE TABLE exam_schedule_classes",
    );
    expect(schedulesMigration.statements[1]).toContain(
      "PRIMARY KEY (schedule_id, class_id)",
    );
    expect(schedulesMigration.statements[2]).toContain(
      "CREATE TABLE exam_schedule_participants",
    );
    expect(schedulesMigration.statements[2]).toContain(
      "PRIMARY KEY (schedule_id, participant_id)",
    );
  });

  test("is registered after the exam migration", () => {
    expect(migrations.at(-1)).toBe(schedulesMigration);
    expect(migrations.map((migration) => migration.id).slice(-2)).toEqual([
      "0011_exams",
      "0012_schedules",
    ]);
  });
});
