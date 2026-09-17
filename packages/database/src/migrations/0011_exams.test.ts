import { describe, expect, test } from "bun:test";
import { examsMigration } from "./0011_exams";
import { migrations } from "./index";

describe("exams migration", () => {
  test("creates logical exam, immutable revision, and ordered question tables", () => {
    expect(examsMigration.id).toBe("0011_exams");
    expect(examsMigration.statements).toHaveLength(4);
    expect(examsMigration.statements[0]).toContain("CREATE TABLE exams");
    expect(examsMigration.statements[0]).toContain(
      "current_published_revision_id BIGINT UNSIGNED NULL",
    );
    expect(examsMigration.statements[1]).toContain(
      "CREATE TABLE exam_revisions",
    );
    expect(examsMigration.statements[1]).toContain(
      "UNIQUE (exam_id, revision_no)",
    );
    expect(examsMigration.statements[1]).toContain("duration_seconds > 0");
    expect(examsMigration.statements[1]).toContain("total_points >= 0.00");
    expect(examsMigration.statements[2]).toContain("fk_exams_current_revision");
    expect(examsMigration.statements[3]).toContain(
      "CREATE TABLE exam_questions",
    );
    expect(examsMigration.statements[3]).toContain(
      "UNIQUE (exam_revision_id, position)",
    );
    expect(examsMigration.statements[3]).toContain(
      "UNIQUE (exam_revision_id, question_revision_id)",
    );
    expect(examsMigration.statements[3]).toContain("points > 0.00");
  });

  test("is registered after the question and media migrations", () => {
    expect(migrations.at(-2)).toBe(examsMigration);
    expect(migrations.map((migration) => migration.id)).toEqual([
      "0001_identity",
      "0002_academic",
      "0003_subjects",
      "0004_system_locks",
      "0005_user_import_previews",
      "0006_import_commit",
      "0007_auth_throttles",
      "0008_question_banks",
      "0009_question_options",
      "0010_media",
      "0011_exams",
      "0012_schedules",
    ]);
  });
});
