import { describe, expect, test } from "bun:test";
import { examSessionCredentialsMigration } from "./0016_exam_session_credentials";
import { migrations } from "./index";

describe("exam session credential migration", () => {
  test("uses forward-only ALTER statements after immutable runtime migrations", () => {
    expect(examSessionCredentialsMigration.id).toBe(
      "0016_exam_session_credentials",
    );
    expect(examSessionCredentialsMigration.statements).toHaveLength(3);
    expect(examSessionCredentialsMigration.statements[0]).toContain(
      "practice_session_credential_hash",
    );
    expect(examSessionCredentialsMigration.statements[1]).toContain(
      "version INT UNSIGNED",
    );
    expect(migrations.at(-1)).toBe(examSessionCredentialsMigration);
  });
});
