import type { Migration } from "../migration-runner";

/** Runtime attempt rows and immutable per-session question manifests. */
export const examSessionsMigration: Migration = {
  id: "0013_exam_sessions",
  statements: [
    `CREATE TABLE exam_sessions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      schedule_id BIGINT UNSIGNED NOT NULL,
      exam_revision_id BIGINT UNSIGNED NOT NULL,
      participant_id BIGINT UNSIGNED NULL,
      attempt_no SMALLINT UNSIGNED NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
      start_idempotency_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      practice_access_token_hash BINARY(32) NULL,
      participant_name_snapshot VARCHAR(200) NOT NULL,
      class_snapshot VARCHAR(150) NULL,
      institution_snapshot VARCHAR(200) NULL,
      identity_extra_json JSON NULL,
      random_seed BINARY(32) NOT NULL,
      started_at DATETIME(6) NOT NULL,
      deadline_at DATETIME(6) NOT NULL,
      last_seen_at DATETIME(6) NOT NULL,
      submitted_at DATETIME(6) NULL,
      expired_at DATETIME(6) NULL,
      ended_at DATETIME(6) NULL,
      scored_at DATETIME(6) NULL,
      finalization_reason VARCHAR(30) NULL,
      finalized_by_user_id BIGINT UNSIGNED NULL,
      finalization_note VARCHAR(500) NULL,
      created_ip_hash BINARY(32) NULL,
      created_at DATETIME(6) NOT NULL DEFAULT UTC_TIMESTAMP(6),
      updated_at DATETIME(6) NOT NULL DEFAULT UTC_TIMESTAMP(6),
      CONSTRAINT pk_exam_sessions PRIMARY KEY (id),
      CONSTRAINT uq_exam_sessions_schedule_start_key UNIQUE (schedule_id, start_idempotency_key),
      CONSTRAINT uq_exam_sessions_attempt UNIQUE (schedule_id, participant_id, attempt_no),
      CONSTRAINT fk_exam_sessions_schedule FOREIGN KEY (schedule_id) REFERENCES exam_schedules (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT fk_exam_sessions_revision FOREIGN KEY (exam_revision_id) REFERENCES exam_revisions (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT fk_exam_sessions_participant FOREIGN KEY (participant_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT fk_exam_sessions_finalized_by FOREIGN KEY (finalized_by_user_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT chk_exam_sessions_attempt CHECK (attempt_no > 0),
      CONSTRAINT chk_exam_sessions_status CHECK (status IN ('ACTIVE', 'SUBMITTED', 'EXPIRED', 'ENDED', 'SCORED')),
      CONSTRAINT chk_exam_sessions_identity_json CHECK (identity_extra_json IS NULL OR JSON_VALID(identity_extra_json)),
      CONSTRAINT chk_exam_sessions_deadline CHECK (deadline_at >= started_at),
      CONSTRAINT chk_exam_sessions_finalization CHECK (
        (status = 'ACTIVE' AND submitted_at IS NULL AND expired_at IS NULL AND ended_at IS NULL AND scored_at IS NULL AND finalization_reason IS NULL)
        OR (status = 'SUBMITTED' AND submitted_at IS NOT NULL AND finalization_reason = 'PARTICIPANT_SUBMIT')
        OR (status = 'EXPIRED' AND expired_at IS NOT NULL AND finalization_reason = 'DEADLINE')
        OR (status = 'ENDED' AND ended_at IS NOT NULL AND finalization_reason IN ('SCHEDULE_CLOSE', 'STAFF_END', 'RESET_ATTEMPT'))
        OR (status = 'SCORED' AND scored_at IS NOT NULL AND finalization_reason IN ('PARTICIPANT_SUBMIT', 'DEADLINE', 'SCHEDULE_CLOSE', 'STAFF_END', 'RESET_ATTEMPT'))
      ),
      INDEX idx_exam_sessions_schedule_status_deadline (schedule_id, status, deadline_at, id),
      INDEX idx_exam_sessions_participant_status_deadline (participant_id, status, deadline_at, id),
      INDEX idx_exam_sessions_status_deadline (status, deadline_at, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE exam_session_questions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      session_id BIGINT UNSIGNED NOT NULL,
      question_revision_id BIGINT UNSIGNED NOT NULL,
      display_position INT UNSIGNED NOT NULL,
      points DECIMAL(10,2) NOT NULL,
      option_order_json JSON NULL,
      statement_order_json JSON NULL,
      created_at DATETIME(6) NOT NULL DEFAULT UTC_TIMESTAMP(6),
      CONSTRAINT pk_exam_session_questions PRIMARY KEY (id),
      CONSTRAINT uq_exam_session_questions_position UNIQUE (session_id, display_position),
      CONSTRAINT uq_exam_session_questions_question UNIQUE (session_id, question_revision_id),
      CONSTRAINT fk_exam_session_questions_session FOREIGN KEY (session_id) REFERENCES exam_sessions (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT fk_exam_session_questions_revision FOREIGN KEY (question_revision_id) REFERENCES question_revisions (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT chk_exam_session_questions_position CHECK (display_position > 0),
      CONSTRAINT chk_exam_session_questions_points CHECK (points > 0.00),
      CONSTRAINT chk_exam_session_questions_option_json CHECK (option_order_json IS NULL OR JSON_VALID(option_order_json)),
      CONSTRAINT chk_exam_session_questions_statement_json CHECK (statement_order_json IS NULL OR JSON_VALID(statement_order_json)),
      INDEX idx_exam_session_questions_session_order (session_id, display_position, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ],
};
