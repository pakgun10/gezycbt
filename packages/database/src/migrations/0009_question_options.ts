import type { Migration } from "../migration-runner";

export const questionOptionsMigration: Migration = {
  id: "0009_question_options",
  statements: [
    `CREATE TABLE question_options (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      question_revision_id BIGINT UNSIGNED NOT NULL,
      position SMALLINT UNSIGNED NOT NULL,
      content_html TEXT NOT NULL,
      is_correct BOOLEAN NOT NULL DEFAULT FALSE,
      CONSTRAINT pk_question_options PRIMARY KEY (id),
      CONSTRAINT uq_question_options_revision_position UNIQUE (question_revision_id, position),
      CONSTRAINT fk_question_options_revision FOREIGN KEY (question_revision_id) REFERENCES question_revisions (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT chk_question_options_position CHECK (position BETWEEN 1 AND 10),
      INDEX idx_question_options_revision_key (question_revision_id, is_correct, position)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE true_false_statements (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      question_revision_id BIGINT UNSIGNED NOT NULL,
      position TINYINT UNSIGNED NOT NULL,
      statement_html TEXT NOT NULL,
      correct_value BOOLEAN NOT NULL,
      CONSTRAINT pk_true_false_statements PRIMARY KEY (id),
      CONSTRAINT uq_true_false_statements_revision_position UNIQUE (question_revision_id, position),
      CONSTRAINT fk_true_false_statements_revision FOREIGN KEY (question_revision_id) REFERENCES question_revisions (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT chk_true_false_statements_position CHECK (position BETWEEN 1 AND 3),
      INDEX idx_true_false_statements_revision (question_revision_id, position)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ],
};
