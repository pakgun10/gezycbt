import type { Migration } from "../migration-runner";

export const importCommitMigration: Migration = {
  id: "0006_import_commit",
  statements: [
    `ALTER TABLE user_import_previews
      ADD COLUMN commit_idempotency_hash BINARY(32) NULL,
      ADD COLUMN commit_result_json JSON NULL,
      ADD COLUMN committed_by_user_id BIGINT UNSIGNED NULL,
      ADD CONSTRAINT fk_user_import_previews_committed_by FOREIGN KEY (committed_by_user_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      ADD INDEX idx_user_import_previews_commit_idempotency (commit_idempotency_hash)`,
    `CREATE TABLE user_import_credential_artifacts (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      preview_id BIGINT UNSIGNED NOT NULL,
      owner_user_id BIGINT UNSIGNED NOT NULL,
      encrypted_payload BLOB NOT NULL,
      expires_at DATETIME(6) NOT NULL,
      downloaded_at DATETIME(6) NULL,
      created_at DATETIME(6) NOT NULL DEFAULT UTC_TIMESTAMP(6),
      CONSTRAINT pk_user_import_credential_artifacts PRIMARY KEY (id),
      CONSTRAINT uq_user_import_credential_artifacts_preview UNIQUE (preview_id),
      CONSTRAINT fk_user_import_credential_artifacts_preview FOREIGN KEY (preview_id) REFERENCES user_import_previews (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT fk_user_import_credential_artifacts_owner FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      INDEX idx_user_import_credential_artifacts_owner_expiry (owner_user_id, expires_at),
      INDEX idx_user_import_credential_artifacts_expiry (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE audit_logs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      actor_user_id BIGINT UNSIGNED NULL,
      actor_type VARCHAR(30) NOT NULL,
      integration_client_id BIGINT UNSIGNED NULL,
      agent_action_request_id BIGINT UNSIGNED NULL,
      action VARCHAR(100) NOT NULL,
      entity_type VARCHAR(100) NOT NULL,
      entity_id BIGINT UNSIGNED NULL,
      request_id VARCHAR(128) NOT NULL,
      ip_hash BINARY(32) NULL,
      metadata_json JSON NOT NULL,
      created_at DATETIME(6) NOT NULL DEFAULT UTC_TIMESTAMP(6),
      CONSTRAINT pk_audit_logs PRIMARY KEY (id),
      CONSTRAINT fk_audit_logs_actor FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT chk_audit_logs_actor_type CHECK (actor_type IN ('HUMAN', 'EXTERNAL_AGENT', 'SYSTEM', 'RECOVERY')),
      INDEX idx_audit_logs_entity (entity_type, entity_id, created_at, id),
      INDEX idx_audit_logs_actor (actor_user_id, created_at, id),
      INDEX idx_audit_logs_request (request_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ],
};
