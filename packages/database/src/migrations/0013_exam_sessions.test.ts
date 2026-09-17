import { describe, expect, test } from "bun:test";
import { examSessionsMigration } from "./0013_exam_sessions";
import { migrations } from "./index";

describe("exam sessions migration", () => {
  test("creates session and immutable manifest tables with idempotency and state constraints", () => {
    expect(examSessionsMigration.id).toBe("0013_exam_sessions");
    expect(examSessionsMigration.statements).toHaveLength(2);
    expect(examSessionsMigration.statements[0]).toContain(
      "CREATE TABLE exam_sessions",
    );
    expect(examSessionsMigration.statements[0]).toContain(
      "UNIQUE (schedule_id, start_idempotency_key)",
    );
    expect(examSessionsMigration.statements[0]).toContain(
      "UNIQUE (schedule_id, participant_id, attempt_no)",
    );
    expect(examSessionsMigration.statements[0]).toContain(
      "finalization_reason",
    );
    expect(examSessionsMigration.statements[1]).toContain(
      "CREATE TABLE exam_session_questions",
    );
    expect(examSessionsMigration.statements[1]).toContain(
      "UNIQUE (session_id, display_position)",
    );
  });

  test("is registered after schedules", () => {
    expect(
      migrations.find((migration) => migration.id === examSessionsMigration.id),
    ).toBe(examSessionsMigration);
    const ids = migrations.map((migration) => migration.id);
    expect(ids.indexOf("0013_exam_sessions")).toBe(
      ids.indexOf("0012_schedules") + 1,
    );
  });
});
