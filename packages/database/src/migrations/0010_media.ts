import type { Migration } from "../migration-runner";

export const mediaMigration: Migration = {
  id: "0010_media",
  statements: [
    `CREATE TABLE media_assets (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      storage_key VARCHAR(255) NOT NULL,
      original_name VARCHAR(255) NOT NULL,
      mime_type VARCHAR(30) NOT NULL,
      byte_size INT UNSIGNED NOT NULL,
      sha256 BINARY(32) NOT NULL,
      width SMALLINT UNSIGNED NOT NULL,
      height SMALLINT UNSIGNED NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'READY',
      created_by BIGINT UNSIGNED NOT NULL,
      created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      CONSTRAINT pk_media_assets PRIMARY KEY (id),
      CONSTRAINT uq_media_assets_storage_key UNIQUE (storage_key),
      CONSTRAINT fk_media_assets_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT chk_media_assets_mime CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
      CONSTRAINT chk_media_assets_size CHECK (byte_size BETWEEN 1 AND 2097152),
      CONSTRAINT chk_media_assets_dimensions CHECK (width BETWEEN 1 AND 2500 AND height BETWEEN 1 AND 2500),
      CONSTRAINT chk_media_assets_status CHECK (status IN ('READY', 'DELETED')),
      INDEX idx_media_assets_sha256 (sha256),
      INDEX idx_media_assets_status_created (status, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE question_revision_media (
      question_revision_id BIGINT UNSIGNED NOT NULL,
      media_asset_id BIGINT UNSIGNED NOT NULL,
      \`usage\` VARCHAR(20) NOT NULL,
      alt_text VARCHAR(500) NULL,
      is_decorative BOOLEAN NOT NULL DEFAULT FALSE,
      created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      CONSTRAINT pk_question_revision_media PRIMARY KEY (question_revision_id, media_asset_id),
      CONSTRAINT fk_question_revision_media_revision FOREIGN KEY (question_revision_id) REFERENCES question_revisions (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT fk_question_revision_media_asset FOREIGN KEY (media_asset_id) REFERENCES media_assets (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT chk_question_revision_media_usage CHECK (\`usage\` IN ('STIMULUS', 'PROMPT', 'EXPLANATION', 'OPTION', 'STATEMENT')),
      CONSTRAINT chk_question_revision_media_alt CHECK (
        (is_decorative = TRUE AND (alt_text IS NULL OR CHAR_LENGTH(TRIM(alt_text)) = 0)) OR
        (is_decorative = FALSE AND alt_text IS NOT NULL AND CHAR_LENGTH(TRIM(alt_text)) BETWEEN 1 AND 500)
      ),
      INDEX idx_question_revision_media_asset (media_asset_id),
      INDEX idx_question_revision_media_revision_usage (question_revision_id, \`usage\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ],
};
