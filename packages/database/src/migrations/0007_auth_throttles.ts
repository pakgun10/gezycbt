import type { Migration } from "../migration-runner";

/** Shared, restart-safe throttling buckets for authentication and abuse controls. */
export const authThrottlesMigration: Migration = {
  id: "0007_auth_throttles",
  statements: [
    `CREATE TABLE auth_throttles (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      category VARCHAR(40) NOT NULL,
      key_hash BINARY(32) NOT NULL,
      window_started_at DATETIME(6) NOT NULL,
      failure_count INT UNSIGNED NOT NULL DEFAULT 0,
      blocked_until DATETIME(6) NULL,
      last_failure_at DATETIME(6) NOT NULL,
      created_at DATETIME(6) NOT NULL DEFAULT UTC_TIMESTAMP(6),
      updated_at DATETIME(6) NOT NULL DEFAULT UTC_TIMESTAMP(6) ON UPDATE UTC_TIMESTAMP(6),
      CONSTRAINT pk_auth_throttles PRIMARY KEY (id),
      CONSTRAINT uq_auth_throttles_category_key UNIQUE (category, key_hash),
      CONSTRAINT chk_auth_throttles_category CHECK (category IN ('LOGIN_ACCOUNT', 'LOGIN_IP', 'PRACTICE_TOKEN', 'PRACTICE_IP', 'MAIN_CODE_IP')),
      CONSTRAINT chk_auth_throttles_failure_count CHECK (failure_count >= 0),
      INDEX idx_auth_throttles_blocked (category, blocked_until),
      INDEX idx_auth_throttles_last_failure (last_failure_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ],
};
