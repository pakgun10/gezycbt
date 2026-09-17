import type { Migration } from "../migration-runner";

/** Adds machine-client ownership and immutable request snapshots to exports. */
export const agentExportsMigration: Migration = {
  id: "0019_agent_exports",
  statements: [
    `ALTER TABLE export_jobs
      ADD integration_client_id BIGINT UNSIGNED NULL,
      ADD integration_grant_version INT UNSIGNED NULL,
      ADD scope_snapshot_json JSON NULL,
      ADD filter_json JSON NULL,
      ADD columns_json JSON NULL,
      ADD row_limit INT UNSIGNED NOT NULL DEFAULT 10000,
      ADD CONSTRAINT fk_export_jobs_integration_client FOREIGN KEY (integration_client_id) REFERENCES integration_clients (id) ON DELETE SET NULL ON UPDATE RESTRICT,
      ADD CONSTRAINT chk_export_jobs_scope_snapshot CHECK (scope_snapshot_json IS NULL OR JSON_VALID(scope_snapshot_json)),
      ADD CONSTRAINT chk_export_jobs_filter_json CHECK (filter_json IS NULL OR JSON_VALID(filter_json)),
      ADD CONSTRAINT chk_export_jobs_columns_json CHECK (columns_json IS NULL OR JSON_VALID(columns_json)),
      ADD CONSTRAINT chk_export_jobs_row_limit CHECK (row_limit BETWEEN 1 AND 100000),
      ADD INDEX idx_export_jobs_client_status (integration_client_id, status, created_at, id)`,
  ],
};
