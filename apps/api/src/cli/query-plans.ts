import { createBunSqlDatabase, type DatabasePort } from "@gezycbt/database";

export interface HotQueryPlanSpec {
  readonly name: string;
  readonly sql: string;
  readonly parameters: readonly unknown[];
  readonly expectedIndexes: readonly string[];
}

export const HOT_QUERY_PLANS: readonly HotQueryPlanSpec[] = [
  {
    name: "practice_token_lookup",
    sql: "SELECT id FROM exam_schedules WHERE mode = 'PRACTICE' AND practice_token_hash = ? LIMIT 1",
    parameters: [new Uint8Array(32)],
    expectedIndexes: ["uq_exam_schedules_practice_token"],
  },
  {
    name: "session_by_id",
    sql: "SELECT id, schedule_id, participant_id, status, deadline_at, version FROM exam_sessions WHERE id = ? LIMIT 1",
    parameters: [0],
    expectedIndexes: ["PRIMARY"],
  },
  {
    name: "manifest_by_session",
    sql: "SELECT id, question_revision_id, display_position, points FROM exam_session_questions WHERE session_id = ? ORDER BY display_position LIMIT 151",
    parameters: [0],
    expectedIndexes: ["idx_exam_session_questions_session_order"],
  },
  {
    name: "answers_by_session",
    sql: "SELECT session_id, session_question_id, version, answered_at FROM answers WHERE session_id = ? ORDER BY session_question_id LIMIT 501",
    parameters: [0],
    expectedIndexes: ["PRIMARY"],
  },
  {
    name: "timeout_finalizer_window",
    sql: "SELECT id FROM exam_sessions WHERE status = 'ACTIVE' AND deadline_at <= ? ORDER BY deadline_at ASC, id ASC LIMIT 100",
    parameters: ["2099-01-01 00:00:00.000000"],
    expectedIndexes: ["idx_exam_sessions_status_deadline"],
  },
  {
    name: "schedule_monitor_counts",
    sql: "SELECT SUM(status = 'ACTIVE') AS active_count, SUM(status IN ('SUBMITTED', 'SCORED')) AS submitted_count, SUM(status = 'EXPIRED') AS expired_count, COUNT(DISTINCT participant_id) AS started_count FROM exam_sessions WHERE schedule_id = ?",
    parameters: [0],
    expectedIndexes: [
      "idx_exam_sessions_schedule_id",
      "idx_exam_sessions_schedule_status_deadline",
    ],
  },
  {
    name: "schedule_monitor_page",
    sql: `SELECT s.id, s.schedule_id, s.participant_id, s.attempt_no, s.status,
            s.participant_name_snapshot, s.deadline_at, s.last_seen_at, s.version,
            s.finalization_reason, COUNT(DISTINCT esq.id) AS question_count,
            COUNT(DISTINCT a.session_question_id) AS answered_count, u.username
     FROM exam_sessions s
     LEFT JOIN users u ON u.id = s.participant_id
     LEFT JOIN exam_session_questions esq ON esq.session_id = s.id
     LEFT JOIN answers a ON a.session_id = s.id
     WHERE s.schedule_id = ?
     GROUP BY s.id, s.schedule_id, s.participant_id, s.attempt_no, s.status,
              s.participant_name_snapshot, s.deadline_at, s.last_seen_at,
              s.version, s.finalization_reason, u.username
     ORDER BY s.id ASC LIMIT 51`,
    parameters: [0],
    expectedIndexes: [
      "idx_exam_sessions_schedule_id",
      "idx_exam_sessions_schedule_status_deadline",
    ],
  },
  {
    name: "schedule_results_page",
    sql: `SELECT r.id, r.session_id, r.participant_id, r.percentage,
            r.released_at, r.scored_at, s.participant_name_snapshot, u.username
     FROM exam_results r
     JOIN exam_sessions s ON s.id = r.session_id
     LEFT JOIN users u ON u.id = r.participant_id
     WHERE r.schedule_id = ?
     ORDER BY r.id ASC LIMIT 51`,
    parameters: [0],
    expectedIndexes: ["idx_exam_results_schedule_id"],
  },
  {
    name: "schedule_target_members",
    sql: `SELECT cm.participant_id
     FROM exam_schedule_classes sc
     JOIN class_members cm ON cm.class_id = sc.class_id AND cm.left_at IS NULL
     WHERE sc.schedule_id = ?`,
    parameters: [0],
    expectedIndexes: ["PRIMARY", "idx_exam_schedule_classes_class"],
  },
];

export interface CapturedQueryPlan {
  readonly name: string;
  readonly sql: string;
  readonly expectedIndexes: readonly string[];
  readonly explainRows: readonly Record<string, unknown>[];
}

export async function captureQueryPlans(
  database: Pick<DatabasePort, "query">,
): Promise<readonly CapturedQueryPlan[]> {
  const plans: CapturedQueryPlan[] = [];
  for (const spec of HOT_QUERY_PLANS) {
    const explainRows = await database.query<Record<string, unknown>>(
      `EXPLAIN FORMAT=JSON ${spec.sql}`,
      spec.parameters,
    );
    plans.push({
      name: spec.name,
      sql: spec.sql,
      expectedIndexes: spec.expectedIndexes,
      explainRows,
    });
  }
  return plans;
}

function databaseUrlFromEnv(): string {
  const value = Bun.env.GEZYCBT_DATABASE_URL ?? Bun.env.DATABASE_URL;
  if (!value) throw new Error("GEZYCBT_DATABASE_URL is required");
  return value;
}

if (import.meta.main) {
  const database = createBunSqlDatabase(databaseUrlFromEnv());
  try {
    const plans = await captureQueryPlans(database);
    const output = Bun.env.GEZYCBT_QUERY_PLAN_OUTPUT ?? "query-plans.json";
    await Bun.write(
      output,
      `${JSON.stringify(
        {
          capturedAt: new Date().toISOString(),
          plans,
        },
        null,
        2,
      )}\n`,
    );
    console.log(`captured ${plans.length} query plans to ${output}`);
  } finally {
    await database.close();
  }
}
