import type { Migration } from "../migration-runner";

export const subjectsMigration: Migration = {
  id: "0003_subjects",
  statements: [
    `CREATE TABLE subjects (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      code VARCHAR(50) NOT NULL,
      name VARCHAR(150) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
      created_at DATETIME(6) NOT NULL DEFAULT UTC_TIMESTAMP(6),
      updated_at DATETIME(6) NOT NULL DEFAULT UTC_TIMESTAMP(6),
      CONSTRAINT pk_subjects PRIMARY KEY (id),
      CONSTRAINT uq_subjects_code UNIQUE (code),
      CONSTRAINT chk_subjects_status CHECK (status IN ('ACTIVE', 'ARCHIVED')),
      CONSTRAINT chk_subjects_name_length CHECK (CHAR_LENGTH(name) BETWEEN 1 AND 150),
      INDEX idx_subjects_status_name (status, name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE teacher_subjects (
      teacher_id BIGINT UNSIGNED NOT NULL,
      subject_id BIGINT UNSIGNED NOT NULL,
      assigned_at DATETIME(6) NOT NULL DEFAULT UTC_TIMESTAMP(6),
      CONSTRAINT pk_teacher_subjects PRIMARY KEY (teacher_id, subject_id),
      CONSTRAINT fk_teacher_subjects_teacher FOREIGN KEY (teacher_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT fk_teacher_subjects_subject FOREIGN KEY (subject_id) REFERENCES subjects (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      INDEX idx_teacher_subjects_subject (subject_id, teacher_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE teacher_classes (
      teacher_id BIGINT UNSIGNED NOT NULL,
      class_id BIGINT UNSIGNED NOT NULL,
      assigned_at DATETIME(6) NOT NULL DEFAULT UTC_TIMESTAMP(6),
      CONSTRAINT pk_teacher_classes PRIMARY KEY (teacher_id, class_id),
      CONSTRAINT fk_teacher_classes_teacher FOREIGN KEY (teacher_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT fk_teacher_classes_class FOREIGN KEY (class_id) REFERENCES classes (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      INDEX idx_teacher_classes_class (class_id, teacher_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ],
};
