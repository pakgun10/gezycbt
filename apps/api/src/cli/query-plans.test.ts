import { describe, expect, test } from "bun:test";
import { captureQueryPlans, HOT_QUERY_PLANS } from "./query-plans";

describe("performance query-plan inventory", () => {
  test("keeps bounded named hot queries with expected index evidence", () => {
    expect(HOT_QUERY_PLANS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(HOT_QUERY_PLANS.map((item) => item.name)).size).toBe(
      HOT_QUERY_PLANS.length,
    );
    for (const item of HOT_QUERY_PLANS) {
      expect(item.sql).toContain("SELECT");
      expect(item.expectedIndexes.length).toBeGreaterThan(0);
      expect(item.parameters.length).toBeGreaterThan(0);
    }
  });

  test("captures rows without leaking database URL or parameter values", async () => {
    const database = {
      query: async <T extends Record<string, unknown>>(
        sql: string,
      ): Promise<readonly T[]> => [
        {
          EXPLAIN: sql.includes("EXPLAIN FORMAT=JSON") ? "plan" : "bad",
        } as unknown as T,
      ],
    };
    const plans = await captureQueryPlans(database);
    expect(plans).toHaveLength(HOT_QUERY_PLANS.length);
    expect(JSON.stringify(plans)).not.toContain("mariadb://");
    expect(plans.every((item) => item.explainRows.length === 1)).toBe(true);
  });
});
