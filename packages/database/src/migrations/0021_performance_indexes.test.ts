import { describe, expect, test } from "bun:test";
import { performanceIndexesMigration } from "./0021_performance_indexes";
import { migrations } from "./index";

describe("performance indexes migration", () => {
  test("adds bounded schedule pagination indexes after the runtime schema", () => {
    expect(performanceIndexesMigration.id).toBe("0021_performance_indexes");
    expect(performanceIndexesMigration.statements).toHaveLength(2);
    expect(performanceIndexesMigration.statements[0]).toContain(
      "idx_exam_sessions_schedule_id",
    );
    expect(performanceIndexesMigration.statements[1]).toContain(
      "idx_exam_results_schedule_id",
    );
    expect(migrations.at(-1)).toBe(performanceIndexesMigration);
  });
});
