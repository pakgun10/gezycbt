import type { Migration } from "../migration-runner";

/** Authoritative answer versions and immutable score snapshots. */
export const answersResultsMigration: Migration = {
  id: "0014_answers_results",
  statements: [
    `CREATE TABLE answers (
      session_id BIGINT UNSIGNED NOT NULL,
      session_question_id BIGINT UNSIGNED NOT NULL,
      response_json JSON NOT NULL,
      version INT UNSIGNED NOT NULL DEFAULT 1,
      answered_at DATETIME(6) NOT NULL DEFAULT UTC_TIMESTAMP(6),
      is_correct BOOLEAN NULL,
      awarded_points DECIMAL(10,2) NULL,
      scored_at DATETIME(6) NULL,
      CONSTRAINT pk_answers PRIMARY KEY (session_id, session_question_id),
      CONSTRAINT fk_answers_session FOREIGN KEY (session_id) REFERENCES exam_sessions (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT fk_answers_session_question FOREIGN KEY (session_question_id) REFERENCES exam_session_questions (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT chk_answers_response_json CHECK (JSON_VALID(response_json)),
      CONSTRAINT chk_answers_version CHECK (version > 0),
      CONSTRAINT chk_answers_awarded_points CHECK (awarded_points IS NULL OR awarded_points >= 0.00),
      CONSTRAINT chk_answers_score_pair CHECK ((is_correct IS NULL AND awarded_points IS NULL AND scored_at IS NULL) OR (is_correct IS NOT NULL AND awarded_points IS NOT NULL AND scored_at IS NOT NULL)),
      INDEX idx_answers_session_answered (session_id, answered_at, session_question_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE exam_results (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      session_id BIGINT UNSIGNED NOT NULL,
      schedule_id BIGINT UNSIGNED NOT NULL,
      participant_id BIGINT UNSIGNED NULL,
      correct_count INT UNSIGNED NOT NULL,
      incorrect_count INT UNSIGNED NOT NULL,
      unanswered_count INT UNSIGNED NOT NULL,
      earned_score DECIMAL(10,2) NOT NULL,
      max_score DECIMAL(10,2) NOT NULL,
      percentage DECIMAL(5,2) NOT NULL,
      scored_at DATETIME(6) NOT NULL,
      released_at DATETIME(6) NULL,
      created_at DATETIME(6) NOT NULL DEFAULT UTC_TIMESTAMP(6),
      CONSTRAINT pk_exam_results PRIMARY KEY (id),
      CONSTRAINT uq_exam_results_session UNIQUE (session_id),
      CONSTRAINT fk_exam_results_session FOREIGN KEY (session_id) REFERENCES exam_sessions (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT fk_exam_results_schedule FOREIGN KEY (schedule_id) REFERENCES exam_schedules (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT fk_exam_results_participant FOREIGN KEY (participant_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT chk_exam_results_score_counts CHECK (correct_count + incorrect_count + unanswered_count >= 0),
      CONSTRAINT chk_exam_results_scores CHECK (earned_score >= 0.00 AND max_score >= 0.00 AND earned_score <= max_score),
      CONSTRAINT chk_exam_results_percentage CHECK (percentage BETWEEN 0.00 AND 100.00),
      INDEX idx_exam_results_schedule_score (schedule_id, earned_score, id),
      INDEX idx_exam_results_participant (participant_id, scored_at, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ],
};
