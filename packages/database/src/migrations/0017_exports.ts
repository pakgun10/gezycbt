import type { Migration } from "../migration-runner";

/** Durable, short-lived export jobs and protected generated files. */
export const exportsMigration: Migration = {
  id: "0017_exports",
  statements: [
    `CREATE TABLE export_jobs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      requester_user_id BIGINT UNSIGNED NOT NULL,
      schedule_id BIGINT UNSIGNED NOT NULL,
      format VARCHAR(10) NOT NULL,
      include_pii BOOLEAN NOT NULL DEFAULT FALSE,
      status VARCHAR(20) NOT NULL DEFAULT 'QUEUED',
      row_count INT UNSIGNED NULL,
      error_message VARCHAR(500) NULL,
      expires_at DATETIME(6) NOT NULL,
      created_at DATETIME(6) NOT NULL DEFAULT UTC_TIMESTAMP(6),
      updated_at DATETIME(6) NOT NULL DEFAULT UTC_TIMESTAMP(6),
      CONSTRAINT pk_export_jobs PRIMARY KEY (id),
      CONSTRAINT fk_export_jobs_requester FOREIGN KEY (requester_user_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT fk_export_jobs_schedule FOREIGN KEY (schedule_id) REFERENCES exam_schedules (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT chk_export_jobs_format CHECK (format IN ('CSV', 'JSON')),
      CONSTRAINT chk_export_jobs_status CHECK (status IN ('QUEUED', 'RUNNING', 'READY', 'FAILED', 'EXPIRED')),
      INDEX idx_export_jobs_requester_created (requester_user_id, created_at, id),
      INDEX idx_export_jobs_schedule_created (schedule_id, created_at, id),
      INDEX idx_export_jobs_expiry (status, expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE export_files (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      export_job_id BIGINT UNSIGNED NOT NULL,
      content_blob LONGBLOB NOT NULL,
      content_sha256 BINARY(32) NOT NULL,
      download_token_digest BINARY(32) NULL,
      download_token_expires_at DATETIME(6) NULL,
      downloaded_at DATETIME(6) NULL,
      created_at DATETIME(6) NOT NULL DEFAULT UTC_TIMESTAMP(6),
      CONSTRAINT pk_export_files PRIMARY KEY (id),
      CONSTRAINT uq_export_files_job UNIQUE (export_job_id),
      CONSTRAINT fk_export_files_job FOREIGN KEY (export_job_id) REFERENCES export_jobs (id) ON DELETE CASCADE ON UPDATE RESTRICT,
      INDEX idx_export_files_token (download_token_digest, download_token_expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ],
};
