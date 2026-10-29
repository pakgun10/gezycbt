import type { Migration } from "../migration-runner";

/**
 * Per-question TRUE_FALSE column labels. NULL means the historic default
 * pair ("Benar" / "Salah"); a stored value only changes the displayed
 * column header, never the boolean answer key or the score.
 */
export const trueFalseLabelsMigration: Migration = {
  id: "0024_true_false_labels",
  statements: [
    `ALTER TABLE question_revisions
       ADD COLUMN true_label VARCHAR(50) NULL AFTER explanation_html,
       ADD COLUMN false_label VARCHAR(50) NULL AFTER true_label,
       ADD CONSTRAINT chk_question_revisions_true_label CHECK (
         true_label IS NULL OR CHAR_LENGTH(TRIM(true_label)) BETWEEN 1 AND 50
       ),
       ADD CONSTRAINT chk_question_revisions_false_label CHECK (
         false_label IS NULL OR CHAR_LENGTH(TRIM(false_label)) BETWEEN 1 AND 50
       )`,
  ],
};
