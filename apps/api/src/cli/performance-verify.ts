import { createBunSqlDatabase, type DatabasePort } from "@gezycbt/database";

interface CountRow extends Record<string, unknown> {
  readonly session_count: unknown;
  readonly distinct_participants: unknown;
  readonly active_count: unknown;
  readonly result_count: unknown;
  readonly distinct_results: unknown;
  readonly answer_count: unknown;
  readonly distinct_answers: unknown;
}

export interface PerformanceVerificationReport {
  readonly scheduleId: string;
  readonly expectedParticipants: number | null;
  readonly observed: {
    readonly sessionCount: number;
    readonly distinctParticipants: number;
    readonly activeCount: number;
    readonly resultCount: number;
    readonly distinctResults: number;
    readonly answerCount: number;
    readonly distinctAnswers: number;
  };
  readonly checks: {
    readonly noDuplicateMainAttempts: boolean;
    readonly noDuplicateResults: boolean;
    readonly noDuplicateAnswers: boolean;
    readonly expectedParticipantsMatched: boolean;
  };
  readonly passed: boolean;
}

export async function verifyPerformanceData(
  database: Pick<DatabasePort, "query">,
  scheduleId: string,
  expectedParticipants?: number,
): Promise<PerformanceVerificationReport> {
  const rows = await database.query<CountRow>(
    `SELECT
       COUNT(DISTINCT s.id) AS session_count,
       COUNT(DISTINCT CASE WHEN s.participant_id IS NOT NULL THEN s.participant_id END) AS distinct_participants,
       SUM(s.status = 'ACTIVE') AS active_count,
       COUNT(DISTINCT r.id) AS result_count,
       COUNT(DISTINCT r.session_id) AS distinct_results,
       COUNT(a.session_id) AS answer_count,
       COUNT(DISTINCT CONCAT(a.session_id, ':', a.session_question_id)) AS distinct_answers
     FROM exam_sessions s
     LEFT JOIN exam_results r ON r.schedule_id = s.schedule_id AND r.session_id = s.id
     LEFT JOIN answers a ON a.session_id = s.id
     WHERE s.schedule_id = ?`,
    [scheduleId],
  );
  const row = rows[0];
  if (!row) throw new Error("Performance verification query returned no row");
  const observed = {
    sessionCount: numberValue(row.session_count),
    distinctParticipants: numberValue(row.distinct_participants),
    activeCount: numberValue(row.active_count),
    resultCount: numberValue(row.result_count),
    distinctResults: numberValue(row.distinct_results),
    answerCount: numberValue(row.answer_count),
    distinctAnswers: numberValue(row.distinct_answers),
  };
  const checks = {
    noDuplicateMainAttempts:
      observed.distinctParticipants === 0 ||
      observed.sessionCount === observed.distinctParticipants,
    noDuplicateResults: observed.resultCount === observed.distinctResults,
    noDuplicateAnswers: observed.answerCount === observed.distinctAnswers,
    expectedParticipantsMatched:
      expectedParticipants === undefined ||
      observed.distinctParticipants === expectedParticipants,
  };
  return {
    scheduleId,
    expectedParticipants: expectedParticipants ?? null,
    observed,
    checks,
    passed: Object.values(checks).every(Boolean),
  };
}

function numberValue(value: unknown): number {
  const result = Number(value ?? 0);
  if (!Number.isFinite(result) || result < 0) throw new Error("Invalid count");
  return result;
}

function requiredEnv(name: string): string {
  const value = Bun.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

if (import.meta.main) {
  const databaseUrl = requiredEnv("GEZYCBT_DATABASE_URL");
  const scheduleId = requiredEnv("GEZYCBT_SCHEDULE_ID");
  const expectedRaw = Bun.env.GEZYCBT_EXPECTED_PARTICIPANTS?.trim();
  const expected = expectedRaw ? Number(expectedRaw) : undefined;
  if (
    expected !== undefined &&
    (!Number.isSafeInteger(expected) || expected < 1 || expected > 1500)
  )
    throw new Error("GEZYCBT_EXPECTED_PARTICIPANTS must be 1..1500");
  const database = createBunSqlDatabase(databaseUrl);
  try {
    const report = await verifyPerformanceData(database, scheduleId, expected);
    const output = Bun.env.GEZYCBT_VERIFY_OUTPUT;
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    if (output) await Bun.write(output, serialized);
    console.log(serialized.trim());
    if (!report.passed) process.exitCode = 1;
  } finally {
    await database.close();
  }
}
