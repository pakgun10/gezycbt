import { describe, expect, test } from "bun:test";
import type { DatabasePort } from "@gezycbt/database";
import { verifyPerformanceData } from "./performance-verify";

describe("performance data verifier", () => {
  test("passes when main attempt, result, and answer keys are unique", async () => {
    const database: Pick<DatabasePort, "query"> = {
      query: async <T extends Record<string, unknown>>() => [
        {
          session_count: 1000,
          distinct_participants: 1000,
          active_count: 0,
          result_count: 1000,
          distinct_results: 1000,
          answer_count: 5000,
          distinct_answers: 5000,
        } as unknown as T,
      ],
    };
    const report = await verifyPerformanceData(database, "99", 1000);
    expect(report.passed).toBe(true);
    expect(report.checks).toEqual({
      noDuplicateMainAttempts: true,
      noDuplicateResults: true,
      noDuplicateAnswers: true,
      expectedParticipantsMatched: true,
    });
  });

  test("fails the gate when a duplicate result or missing participant exists", async () => {
    const database: Pick<DatabasePort, "query"> = {
      query: async <T extends Record<string, unknown>>() => [
        {
          session_count: 3,
          distinct_participants: 2,
          active_count: 0,
          result_count: 3,
          distinct_results: 2,
          answer_count: 2,
          distinct_answers: 1,
        } as unknown as T,
      ],
    };
    const report = await verifyPerformanceData(database, "99", 3);
    expect(report.passed).toBe(false);
    expect(report.checks.noDuplicateMainAttempts).toBe(false);
    expect(report.checks.noDuplicateResults).toBe(false);
    expect(report.checks.noDuplicateAnswers).toBe(false);
    expect(report.checks.expectedParticipantsMatched).toBe(false);
  });
});
