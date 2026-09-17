import type { Migration } from "../migration-runner";

/** Logical exams and immutable authoring revisions. */
export const examsMigration: Migration = {
  id: "0011_exams",
  statements: [
    `CREATE TABLE exams (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      subject_id BIGINT UNSIGNED NOT NULL,
      owner_teacher_id BIGINT UNSIGNED NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
      current_published_revision_id BIGINT UNSIGNED NULL,
      created_at DATETIME(6) NOT NULL DEFAULT UTC_TIMESTAMP(6),
      updated_at DATETIME(6) NOT NULL DEFAULT UTC_TIMESTAMP(6),
      CONSTRAINT pk_exams PRIMARY KEY (id),
      CONSTRAINT fk_exams_subject FOREIGN KEY (subject_id) REFERENCES subjects (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT fk_exams_owner FOREIGN KEY (owner_teacher_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT chk_exams_status CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
      INDEX idx_exams_owner_scope (owner_teacher_id, subject_id, status, updated_at, id),
      INDEX idx_exams_subject_status (subject_id, status, updated_at, id),
      INDEX idx_exams_current_revision (current_published_revision_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE exam_revisions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      exam_id BIGINT UNSIGNED NOT NULL,
      revision_no INT UNSIGNED NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
      title VARCHAR(250) NOT NULL,
      instructions_html LONGTEXT NOT NULL,
      duration_seconds INT UNSIGNED NOT NULL,
      shuffle_questions BOOLEAN NOT NULL DEFAULT FALSE,
      shuffle_options BOOLEAN NOT NULL DEFAULT FALSE,
      total_points DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      published_at DATETIME(6) NULL,
      created_at DATETIME(6) NOT NULL DEFAULT UTC_TIMESTAMP(6),
      updated_at DATETIME(6) NOT NULL DEFAULT UTC_TIMESTAMP(6),
      CONSTRAINT pk_exam_revisions PRIMARY KEY (id),
      CONSTRAINT uq_exam_revisions_number UNIQUE (exam_id, revision_no),
      CONSTRAINT fk_exam_revisions_exam FOREIGN KEY (exam_id) REFERENCES exams (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT chk_exam_revisions_status CHECK (status IN ('DRAFT', 'PUBLISHED')),
      CONSTRAINT chk_exam_revisions_revision_no CHECK (revision_no > 0),
      CONSTRAINT chk_exam_revisions_title_length CHECK (CHAR_LENGTH(title) BETWEEN 1 AND 250),
      CONSTRAINT chk_exam_revisions_duration CHECK (duration_seconds > 0),
      CONSTRAINT chk_exam_revisions_total_points CHECK (total_points >= 0.00),
      CONSTRAINT chk_exam_revisions_publish_time CHECK ((status = 'DRAFT' AND published_at IS NULL) OR (status = 'PUBLISHED' AND published_at IS NOT NULL)),
      INDEX idx_exam_revisions_exam_status (exam_id, status, revision_no),
      INDEX idx_exam_revisions_status_updated (status, updated_at, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `ALTER TABLE exams
      ADD CONSTRAINT fk_exams_current_revision FOREIGN KEY (current_published_revision_id) REFERENCES exam_revisions (id) ON DELETE RESTRICT ON UPDATE RESTRICT`,
    `CREATE TABLE exam_questions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      exam_revision_id BIGINT UNSIGNED NOT NULL,
      question_revision_id BIGINT UNSIGNED NOT NULL,
      position INT UNSIGNED NOT NULL,
      points DECIMAL(10,2) NOT NULL,
      created_at DATETIME(6) NOT NULL DEFAULT UTC_TIMESTAMP(6),
      CONSTRAINT pk_exam_questions PRIMARY KEY (id),
      CONSTRAINT uq_exam_questions_revision_position UNIQUE (exam_revision_id, position),
      CONSTRAINT uq_exam_questions_revision_question UNIQUE (exam_revision_id, question_revision_id),
      CONSTRAINT fk_exam_questions_exam_revision FOREIGN KEY (exam_revision_id) REFERENCES exam_revisions (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT fk_exam_questions_question_revision FOREIGN KEY (question_revision_id) REFERENCES question_revisions (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT chk_exam_questions_position CHECK (position > 0),
      CONSTRAINT chk_exam_questions_points CHECK (points > 0.00),
      INDEX idx_exam_questions_question_revision (question_revision_id, exam_revision_id),
      INDEX idx_exam_questions_revision_order (exam_revision_id, position, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ],
};
