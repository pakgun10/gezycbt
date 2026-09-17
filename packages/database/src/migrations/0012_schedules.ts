import type { Migration } from "../migration-runner";

/** Schedule policy, access mode, and explicit/class targets. */
export const schedulesMigration: Migration = {
  id: "0012_schedules",
  statements: [
    `CREATE TABLE exam_schedules (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      exam_revision_id BIGINT UNSIGNED NOT NULL,
      mode VARCHAR(20) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
      starts_at DATETIME(6) NOT NULL,
      ends_at DATETIME(6) NOT NULL,
      duration_seconds INT UNSIGNED NOT NULL,
      max_attempts SMALLINT UNSIGNED NOT NULL DEFAULT 1,
      hard_end BOOLEAN NOT NULL DEFAULT TRUE,
      allow_late_start BOOLEAN NOT NULL DEFAULT TRUE,
      result_release_policy VARCHAR(30) NOT NULL,
      practice_token_hash BINARY(32) NULL,
      practice_token_hint VARCHAR(20) NULL,
      main_access_code_hash BINARY(32) NULL,
      main_access_code_hint VARCHAR(20) NULL,
      identity_fields_json JSON NULL,
      closed_at DATETIME(6) NULL,
      closed_by_user_id BIGINT UNSIGNED NULL,
      close_reason VARCHAR(500) NULL,
      created_at DATETIME(6) NOT NULL DEFAULT UTC_TIMESTAMP(6),
      updated_at DATETIME(6) NOT NULL DEFAULT UTC_TIMESTAMP(6),
      CONSTRAINT pk_exam_schedules PRIMARY KEY (id),
      CONSTRAINT fk_exam_schedules_revision FOREIGN KEY (exam_revision_id) REFERENCES exam_revisions (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT fk_exam_schedules_closed_by FOREIGN KEY (closed_by_user_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT uq_exam_schedules_practice_token UNIQUE (practice_token_hash),
      CONSTRAINT uq_exam_schedules_main_code UNIQUE (main_access_code_hash),
      CONSTRAINT chk_exam_schedules_mode CHECK (mode IN ('MAIN', 'PRACTICE')),
      CONSTRAINT chk_exam_schedules_status CHECK (status IN ('DRAFT', 'READY', 'OPEN', 'CLOSED', 'ARCHIVED')),
      CONSTRAINT chk_exam_schedules_window CHECK (starts_at < ends_at),
      CONSTRAINT chk_exam_schedules_duration CHECK (duration_seconds BETWEEN 1 AND 86400),
      CONSTRAINT chk_exam_schedules_attempts CHECK ((mode = 'MAIN' AND max_attempts = 1) OR (mode = 'PRACTICE' AND max_attempts > 0)),
      CONSTRAINT chk_exam_schedules_hard_end CHECK (hard_end = TRUE),
      CONSTRAINT chk_exam_schedules_release_policy CHECK ((mode = 'MAIN' AND result_release_policy = 'MANUAL') OR (mode = 'PRACTICE' AND result_release_policy = 'IMMEDIATE_SCORE')),
      CONSTRAINT chk_exam_schedules_access_fields CHECK ((mode = 'MAIN' AND practice_token_hash IS NULL AND identity_fields_json IS NULL) OR (mode = 'PRACTICE' AND main_access_code_hash IS NULL)),
      CONSTRAINT chk_exam_schedules_access_ready CHECK (status = 'DRAFT' OR ((mode = 'MAIN' AND main_access_code_hash IS NOT NULL) OR (mode = 'PRACTICE' AND practice_token_hash IS NOT NULL AND identity_fields_json IS NOT NULL))),
      CONSTRAINT chk_exam_schedules_identity_json CHECK (identity_fields_json IS NULL OR JSON_VALID(identity_fields_json)),
      CONSTRAINT chk_exam_schedules_closed CHECK (
        (status IN ('DRAFT', 'READY', 'OPEN') AND closed_at IS NULL AND closed_by_user_id IS NULL AND close_reason IS NULL)
        OR
        (status IN ('CLOSED', 'ARCHIVED') AND closed_at IS NOT NULL AND (closed_by_user_id IS NULL OR (close_reason IS NOT NULL AND CHAR_LENGTH(TRIM(close_reason)) BETWEEN 1 AND 500)))
      ),
      INDEX idx_exam_schedules_status_start (status, starts_at, id),
      INDEX idx_exam_schedules_status_end (status, ends_at, id),
      INDEX idx_exam_schedules_revision_start (exam_revision_id, starts_at, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE exam_schedule_classes (
      schedule_id BIGINT UNSIGNED NOT NULL,
      class_id BIGINT UNSIGNED NOT NULL,
      created_at DATETIME(6) NOT NULL DEFAULT UTC_TIMESTAMP(6),
      CONSTRAINT pk_exam_schedule_classes PRIMARY KEY (schedule_id, class_id),
      CONSTRAINT fk_exam_schedule_classes_schedule FOREIGN KEY (schedule_id) REFERENCES exam_schedules (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT fk_exam_schedule_classes_class FOREIGN KEY (class_id) REFERENCES classes (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      INDEX idx_exam_schedule_classes_class (class_id, schedule_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE exam_schedule_participants (
      schedule_id BIGINT UNSIGNED NOT NULL,
      participant_id BIGINT UNSIGNED NOT NULL,
      created_at DATETIME(6) NOT NULL DEFAULT UTC_TIMESTAMP(6),
      CONSTRAINT pk_exam_schedule_participants PRIMARY KEY (schedule_id, participant_id),
      CONSTRAINT fk_exam_schedule_participants_schedule FOREIGN KEY (schedule_id) REFERENCES exam_schedules (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT fk_exam_schedule_participants_participant FOREIGN KEY (participant_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      INDEX idx_exam_schedule_participants_participant (participant_id, schedule_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ],
};
