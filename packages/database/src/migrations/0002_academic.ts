import type { Migration } from "../migration-runner";

export const academicMigration: Migration = {
  id: "0002_academic",
  statements: [
    `CREATE TABLE academic_years (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(50) NOT NULL,
      starts_on DATE NOT NULL,
      ends_on DATE NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT FALSE,
      created_at DATETIME(6) NOT NULL DEFAULT UTC_TIMESTAMP(6),
      updated_at DATETIME(6) NOT NULL DEFAULT UTC_TIMESTAMP(6),
      CONSTRAINT pk_academic_years PRIMARY KEY (id),
      CONSTRAINT uq_academic_years_name UNIQUE (name),
      CONSTRAINT chk_academic_years_dates CHECK (starts_on < ends_on),
      INDEX idx_academic_years_active (is_active, starts_on)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE classes (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      academic_year_id BIGINT UNSIGNED NOT NULL,
      code VARCHAR(50) NOT NULL,
      name VARCHAR(150) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
      created_at DATETIME(6) NOT NULL DEFAULT UTC_TIMESTAMP(6),
      updated_at DATETIME(6) NOT NULL DEFAULT UTC_TIMESTAMP(6),
      CONSTRAINT pk_classes PRIMARY KEY (id),
      CONSTRAINT uq_classes_year_code UNIQUE (academic_year_id, code),
      CONSTRAINT fk_classes_academic_year FOREIGN KEY (academic_year_id) REFERENCES academic_years (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT chk_classes_status CHECK (status IN ('ACTIVE', 'ARCHIVED')),
      INDEX idx_classes_year_status (academic_year_id, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE class_members (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      class_id BIGINT UNSIGNED NOT NULL,
      participant_id BIGINT UNSIGNED NOT NULL,
      joined_at DATETIME(6) NOT NULL DEFAULT UTC_TIMESTAMP(6),
      left_at DATETIME(6) NULL,
      CONSTRAINT pk_class_members PRIMARY KEY (id),
      CONSTRAINT uq_class_members_history UNIQUE (class_id, participant_id, joined_at),
      CONSTRAINT fk_class_members_class FOREIGN KEY (class_id) REFERENCES classes (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT fk_class_members_participant FOREIGN KEY (participant_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT chk_class_members_dates CHECK (left_at IS NULL OR left_at >= joined_at),
      INDEX idx_class_members_participant (participant_id, left_at),
      INDEX idx_class_members_active (class_id, left_at, participant_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ],
};
