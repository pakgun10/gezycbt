import { describe, expect, test } from "bun:test";
import { attemptGrantsMigration } from "./0015_attempt_grants";

describe("attempt grants migration", () => {
  test("protects source, attempt number, reset key, and single consumption", () => {
    expect(attemptGrantsMigration.id).toBe("0015_attempt_grants");
    const ddl = attemptGrantsMigration.statements[0] ?? "";
    expect(ddl).toContain("UNIQUE (source_session_id)");
    expect(ddl).toContain(
      "UNIQUE (schedule_id, participant_id, granted_attempt_no)",
    );
    expect(ddl).toContain("UNIQUE (schedule_id, reset_idempotency_key)");
    expect(ddl).toContain("UNIQUE (consumed_by_session_id)");
    expect(ddl).toContain("consumed_at DATETIME(6)");
  });
});
