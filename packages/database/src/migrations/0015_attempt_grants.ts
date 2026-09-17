import type { Migration } from "../migration-runner";

/** Admin reset grants consumed atomically by exactly one replacement session. */
export const attemptGrantsMigration: Migration = {
  id: "0015_attempt_grants",
  statements: [
    `CREATE TABLE exam_attempt_grants (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      schedule_id BIGINT UNSIGNED NOT NULL,
      participant_id BIGINT UNSIGNED NOT NULL,
      source_session_id BIGINT UNSIGNED NOT NULL,
      granted_attempt_no SMALLINT UNSIGNED NOT NULL,
      reason VARCHAR(500) NOT NULL,
      granted_by_user_id BIGINT UNSIGNED NOT NULL,
      reset_idempotency_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      consumed_by_session_id BIGINT UNSIGNED NULL,
      created_at DATETIME(6) NOT NULL DEFAULT UTC_TIMESTAMP(6),
      consumed_at DATETIME(6) NULL,
      CONSTRAINT pk_exam_attempt_grants PRIMARY KEY (id),
      CONSTRAINT uq_exam_attempt_grants_source UNIQUE (source_session_id),
      CONSTRAINT uq_exam_attempt_grants_attempt UNIQUE (schedule_id, participant_id, granted_attempt_no),
      CONSTRAINT uq_exam_attempt_grants_reset_key UNIQUE (schedule_id, reset_idempotency_key),
      CONSTRAINT uq_exam_attempt_grants_consumed_session UNIQUE (consumed_by_session_id),
      CONSTRAINT fk_exam_attempt_grants_schedule FOREIGN KEY (schedule_id) REFERENCES exam_schedules (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT fk_exam_attempt_grants_participant FOREIGN KEY (participant_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT fk_exam_attempt_grants_source_session FOREIGN KEY (source_session_id) REFERENCES exam_sessions (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT fk_exam_attempt_grants_granted_by FOREIGN KEY (granted_by_user_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT fk_exam_attempt_grants_consumed_session FOREIGN KEY (consumed_by_session_id) REFERENCES exam_sessions (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT chk_exam_attempt_grants_attempt CHECK (granted_attempt_no > 0),
      CONSTRAINT chk_exam_attempt_grants_reason CHECK (CHAR_LENGTH(TRIM(reason)) BETWEEN 1 AND 500),
      CONSTRAINT chk_exam_attempt_grants_consumed_pair CHECK ((consumed_by_session_id IS NULL AND consumed_at IS NULL) OR (consumed_by_session_id IS NOT NULL AND consumed_at IS NOT NULL)),
      INDEX idx_exam_attempt_grants_participant_pending (participant_id, consumed_at, schedule_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ],
};
