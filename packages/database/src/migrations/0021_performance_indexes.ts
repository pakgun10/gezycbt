import type { Migration } from "../migration-runner";

/** Supporting indexes proven by the Fase 10 participant/monitoring hot paths. */
export const performanceIndexesMigration: Migration = {
  id: "0021_performance_indexes",
  statements: [
    `ALTER TABLE exam_sessions
       ADD INDEX idx_exam_sessions_schedule_id (schedule_id, id)`,
    `ALTER TABLE exam_results
       ADD INDEX idx_exam_results_schedule_id (schedule_id, id)`,
  ],
};
