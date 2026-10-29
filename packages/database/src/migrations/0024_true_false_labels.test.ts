import { describe, expect, test } from "bun:test";
import { trueFalseLabelsMigration } from "./0024_true_false_labels";
import { migrations } from "./index";

describe("TRUE_FALSE labels migration", () => {
  test("adds nullable label columns to question revisions", () => {
    expect(trueFalseLabelsMigration.id).toBe("0024_true_false_labels");
    const schema = trueFalseLabelsMigration.statements.join("\n");
    expect(schema).toContain("true_label VARCHAR(50) NULL");
    expect(schema).toContain("false_label VARCHAR(50) NULL");
    expect(migrations.at(-1)).toBe(trueFalseLabelsMigration);
  });
});
