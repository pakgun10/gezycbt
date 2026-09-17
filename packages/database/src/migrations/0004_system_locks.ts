import type { Migration } from "../migration-runner";

export const systemLocksMigration: Migration = {
  id: "0004_system_locks",
  statements: [
    `CREATE TABLE system_locks (
      lock_name VARCHAR(64) NOT NULL,
      touched_at DATETIME(6) NOT NULL DEFAULT UTC_TIMESTAMP(6),
      CONSTRAINT pk_system_locks PRIMARY KEY (lock_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    "INSERT INTO system_locks (lock_name) VALUES ('ADMIN_BOOTSTRAP')",
  ],
};
