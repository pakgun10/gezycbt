import type { Migration } from "../migration-runner";

/** Version activation, stable answer lineage, schedule lock, and Regrade audit. */
export const questionVersioningQuizLockRegradeMigration: Migration = {
  id: "0023_question_versioning_quiz_lock_regrade",
  statements: [
    `ALTER TABLE questions
       ADD COLUMN current_published_revision_id BIGINT UNSIGNED NULL AFTER status,
       ADD INDEX idx_questions_current_published_revision (current_published_revision_id)`,
    `UPDATE questions q
     JOIN (
       SELECT question_id, MAX(revision_no) AS revision_no
       FROM question_revisions
       WHERE status = 'PUBLISHED'
       GROUP BY question_id
     ) latest ON latest.question_id = q.id
     JOIN question_revisions qr
       ON qr.question_id = latest.question_id
      AND qr.revision_no = latest.revision_no
     SET q.current_published_revision_id = qr.id`,
    `ALTER TABLE questions
       ADD CONSTRAINT fk_questions_current_published_revision
       FOREIGN KEY (current_published_revision_id) REFERENCES question_revisions (id)
       ON DELETE RESTRICT ON UPDATE RESTRICT`,
    `ALTER TABLE question_options
       ADD COLUMN stable_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER id`,
    "UPDATE question_options SET stable_key = UUID() WHERE stable_key IS NULL",
    `ALTER TABLE question_options
       MODIFY COLUMN stable_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
       ADD CONSTRAINT uq_question_options_revision_stable_key
       UNIQUE (question_revision_id, stable_key),
       ADD INDEX idx_question_options_stable_key (stable_key)`,
    `ALTER TABLE true_false_statements
       ADD COLUMN stable_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER id`,
    "UPDATE true_false_statements SET stable_key = UUID() WHERE stable_key IS NULL",
    `ALTER TABLE true_false_statements
       MODIFY COLUMN stable_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
       ADD CONSTRAINT uq_true_false_statements_revision_stable_key
       UNIQUE (question_revision_id, stable_key),
       ADD INDEX idx_true_false_statements_stable_key (stable_key)`,
    `ALTER TABLE exam_schedules
       ADD COLUMN structure_locked_at DATETIME(6) NULL AFTER updated_at,
       ADD COLUMN structure_locked_by_session_id BIGINT UNSIGNED NULL AFTER structure_locked_at,
       ADD INDEX idx_exam_schedules_structure_lock (structure_locked_at, structure_locked_by_session_id)`,
    `UPDATE exam_schedules es
     JOIN exam_sessions first_session ON first_session.id = (
       SELECT candidate.id
       FROM exam_sessions candidate
       WHERE candidate.schedule_id = es.id
       ORDER BY candidate.started_at ASC, candidate.id ASC
       LIMIT 1
     )
     SET es.structure_locked_at = first_session.started_at,
         es.structure_locked_by_session_id = first_session.id
     WHERE es.structure_locked_at IS NULL`,
    `ALTER TABLE exam_schedules
       ADD CONSTRAINT fk_exam_schedules_structure_lock_session
       FOREIGN KEY (structure_locked_by_session_id) REFERENCES exam_sessions (id)
       ON DELETE RESTRICT ON UPDATE RESTRICT`,
    `CREATE TABLE exam_regrade_runs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      schedule_id BIGINT UNSIGNED NOT NULL,
      requested_by_user_id BIGINT UNSIGNED NOT NULL,
      request_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      reason VARCHAR(500) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'COMPLETED',
      created_at DATETIME(6) NOT NULL DEFAULT UTC_TIMESTAMP(6),
      completed_at DATETIME(6) NULL,
      CONSTRAINT pk_exam_regrade_runs PRIMARY KEY (id),
      CONSTRAINT uq_exam_regrade_runs_request UNIQUE (schedule_id, request_key),
      CONSTRAINT fk_exam_regrade_runs_schedule FOREIGN KEY (schedule_id) REFERENCES exam_schedules (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT fk_exam_regrade_runs_actor FOREIGN KEY (requested_by_user_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT chk_exam_regrade_runs_reason CHECK (CHAR_LENGTH(TRIM(reason)) BETWEEN 3 AND 500),
      CONSTRAINT chk_exam_regrade_runs_status CHECK (status IN ('COMPLETED', 'FAILED')),
      INDEX idx_exam_regrade_runs_schedule_created (schedule_id, created_at, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE exam_regrade_items (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      regrade_run_id BIGINT UNSIGNED NOT NULL,
      result_id BIGINT UNSIGNED NOT NULL,
      source_question_revision_id BIGINT UNSIGNED NULL,
      target_question_revision_id BIGINT UNSIGNED NULL,
      eligible BOOLEAN NOT NULL,
      reason_code VARCHAR(60) NULL,
      before_correct_count INT UNSIGNED NULL,
      before_incorrect_count INT UNSIGNED NULL,
      before_unanswered_count INT UNSIGNED NULL,
      before_earned_score DECIMAL(10,2) NULL,
      before_max_score DECIMAL(10,2) NULL,
      before_percentage DECIMAL(5,2) NULL,
      after_correct_count INT UNSIGNED NULL,
      after_incorrect_count INT UNSIGNED NULL,
      after_unanswered_count INT UNSIGNED NULL,
      after_earned_score DECIMAL(10,2) NULL,
      after_max_score DECIMAL(10,2) NULL,
      after_percentage DECIMAL(5,2) NULL,
      created_at DATETIME(6) NOT NULL DEFAULT UTC_TIMESTAMP(6),
      CONSTRAINT pk_exam_regrade_items PRIMARY KEY (id),
      CONSTRAINT uq_exam_regrade_items_run_result UNIQUE (regrade_run_id, result_id),
      CONSTRAINT fk_exam_regrade_items_run FOREIGN KEY (regrade_run_id) REFERENCES exam_regrade_runs (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT fk_exam_regrade_items_result FOREIGN KEY (result_id) REFERENCES exam_results (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT fk_exam_regrade_items_source_revision FOREIGN KEY (source_question_revision_id) REFERENCES question_revisions (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT fk_exam_regrade_items_target_revision FOREIGN KEY (target_question_revision_id) REFERENCES question_revisions (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      INDEX idx_exam_regrade_items_result (result_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ],
};
