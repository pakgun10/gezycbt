import type { Migration } from "../migration-runner";

/** Target-aware media placements for rich question content. */
export const questionMediaPlacementsMigration: Migration = {
  id: "0022_question_media_placements",
  before: async (database) => {
    const rows = await database.query<{ total: unknown }>(
      "SELECT COUNT(*) AS total FROM question_revision_media WHERE `usage` IN ('OPTION', 'STATEMENT')",
    );
    if (Number(rows[0]?.total ?? 0) > 0)
      throw new Error(
        "Migration 0022 requires manual mapping for legacy OPTION/STATEMENT media relations before deployment",
      );
  },
  statements: [
    `CREATE TABLE question_media_placements (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      placement_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      question_revision_id BIGINT UNSIGNED NOT NULL,
      media_asset_id BIGINT UNSIGNED NOT NULL,
      \`usage\` VARCHAR(20) NOT NULL,
      question_option_id BIGINT UNSIGNED NULL,
      true_false_statement_id BIGINT UNSIGNED NULL,
      sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
      alt_text VARCHAR(500) NULL,
      is_decorative BOOLEAN NOT NULL DEFAULT FALSE,
      display_width_percent TINYINT UNSIGNED NOT NULL DEFAULT 100,
      alignment VARCHAR(10) NOT NULL DEFAULT 'CENTER',
      created_at DATETIME(6) NOT NULL DEFAULT UTC_TIMESTAMP(6),
      updated_at DATETIME(6) NOT NULL DEFAULT UTC_TIMESTAMP(6),
      CONSTRAINT pk_question_media_placements PRIMARY KEY (id),
      CONSTRAINT uq_question_media_placements_key UNIQUE (question_revision_id, placement_key),
      CONSTRAINT fk_question_media_placements_revision FOREIGN KEY (question_revision_id) REFERENCES question_revisions (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT fk_question_media_placements_asset FOREIGN KEY (media_asset_id) REFERENCES media_assets (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT fk_question_media_placements_option FOREIGN KEY (question_option_id) REFERENCES question_options (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT fk_question_media_placements_statement FOREIGN KEY (true_false_statement_id) REFERENCES true_false_statements (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT chk_question_media_placements_usage CHECK (\`usage\` IN ('STIMULUS', 'PROMPT', 'EXPLANATION', 'OPTION', 'STATEMENT')),
      CONSTRAINT chk_question_media_placements_alt CHECK (
        (is_decorative = TRUE AND (alt_text IS NULL OR CHAR_LENGTH(TRIM(alt_text)) = 0)) OR
        (is_decorative = FALSE AND alt_text IS NOT NULL AND CHAR_LENGTH(TRIM(alt_text)) BETWEEN 1 AND 500)
      ),
      CONSTRAINT chk_question_media_placements_width CHECK (display_width_percent BETWEEN 10 AND 100),
      CONSTRAINT chk_question_media_placements_alignment CHECK (alignment IN ('LEFT', 'CENTER', 'RIGHT')),
      INDEX idx_question_media_placements_asset (media_asset_id),
      INDEX idx_question_media_placements_revision_target (question_revision_id, \`usage\`, question_option_id, true_false_statement_id, sort_order),
      INDEX idx_question_media_placements_created (created_at, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `INSERT INTO question_media_placements
       (placement_key, question_revision_id, media_asset_id, \`usage\`, alt_text,
        is_decorative, sort_order, display_width_percent, alignment)
     SELECT CONCAT('legacy-', qrm.question_revision_id, '-', qrm.media_asset_id),
            qrm.question_revision_id, qrm.media_asset_id, qrm.\`usage\`,
            qrm.alt_text, qrm.is_decorative, 0, 100, 'CENTER'
     FROM question_revision_media qrm`,
    "SET SESSION group_concat_max_len = 65535",
    `UPDATE question_revisions qr
     JOIN (
       SELECT qrm.question_revision_id,
              GROUP_CONCAT(
                CONCAT('<figure data-content-node="question-media" data-media-placement="legacy-', qrm.question_revision_id, '-', qrm.media_asset_id, '"></figure>')
                ORDER BY qrm.media_asset_id SEPARATOR ''
              ) AS placeholders
       FROM question_revision_media qrm
       WHERE qrm.\`usage\` = 'STIMULUS'
       GROUP BY qrm.question_revision_id
     ) legacy ON legacy.question_revision_id = qr.id
     SET qr.stimulus_html = CONCAT(qr.stimulus_html, legacy.placeholders)
     WHERE legacy.placeholders IS NOT NULL`,
    `UPDATE question_revisions qr
     JOIN (
       SELECT qrm.question_revision_id,
              GROUP_CONCAT(
                CONCAT('<figure data-content-node="question-media" data-media-placement="legacy-', qrm.question_revision_id, '-', qrm.media_asset_id, '"></figure>')
                ORDER BY qrm.media_asset_id SEPARATOR ''
              ) AS placeholders
       FROM question_revision_media qrm
       WHERE qrm.\`usage\` = 'PROMPT'
       GROUP BY qrm.question_revision_id
     ) legacy ON legacy.question_revision_id = qr.id
     SET qr.prompt_html = CONCAT(COALESCE(qr.prompt_html, ''), legacy.placeholders)
     WHERE legacy.placeholders IS NOT NULL`,
    `UPDATE question_revisions qr
     JOIN (
       SELECT qrm.question_revision_id,
              GROUP_CONCAT(
                CONCAT('<figure data-content-node="question-media" data-media-placement="legacy-', qrm.question_revision_id, '-', qrm.media_asset_id, '"></figure>')
                ORDER BY qrm.media_asset_id SEPARATOR ''
              ) AS placeholders
       FROM question_revision_media qrm
       WHERE qrm.\`usage\` = 'EXPLANATION'
       GROUP BY qrm.question_revision_id
     ) legacy ON legacy.question_revision_id = qr.id
     SET qr.explanation_html = CONCAT(COALESCE(qr.explanation_html, ''), legacy.placeholders)
     WHERE legacy.placeholders IS NOT NULL`,
  ],
};
