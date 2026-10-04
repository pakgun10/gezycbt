import { describe, expect, test } from "bun:test";
import { questionVersioningQuizLockRegradeMigration } from "./0023_question_versioning_quiz_lock_regrade";
import { migrations } from "./index";

describe("question versioning, schedule lock, and regrade migration", () => {
  test("activates a published revision and preserves answer lineage", () => {
    expect(questionVersioningQuizLockRegradeMigration.id).toBe(
      "0023_question_versioning_quiz_lock_regrade",
    );
    const schema =
      questionVersioningQuizLockRegradeMigration.statements.join("\n");
    expect(schema).toContain("current_published_revision_id");
    expect(schema).toContain("stable_key");
    expect(schema).toContain("structure_locked_by_session_id");
    expect(schema).toContain("CREATE TABLE exam_regrade_runs");
    expect(migrations.at(-1)).toBe(questionVersioningQuizLockRegradeMigration);
  });
});
