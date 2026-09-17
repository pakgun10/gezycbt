import { describe, expect, test } from "bun:test";
import { answersResultsMigration } from "./0014_answers_results";

describe("answers and results migration", () => {
  test("creates versioned answers and unique score snapshots", () => {
    expect(answersResultsMigration.id).toBe("0014_answers_results");
    expect(answersResultsMigration.statements).toHaveLength(2);
    expect(answersResultsMigration.statements[0]).toContain(
      "PRIMARY KEY (session_id, session_question_id)",
    );
    expect(answersResultsMigration.statements[0]).toContain(
      "response_json JSON NOT NULL",
    );
    expect(answersResultsMigration.statements[1]).toContain(
      "UNIQUE (session_id)",
    );
    expect(answersResultsMigration.statements[1]).toContain(
      "percentage DECIMAL(5,2)",
    );
  });
});
