import { describe, expect, test } from "bun:test";
import { agentExportsMigration } from "./0019_agent_exports";
import { migrations } from "./index";

describe("agent exports migration", () => {
  test("adds client ownership and immutable export request snapshots", () => {
    expect(agentExportsMigration.id).toBe("0019_agent_exports");
    expect(agentExportsMigration.statements).toHaveLength(1);
    expect(agentExportsMigration.statements[0]).toContain(
      "integration_client_id BIGINT UNSIGNED NULL",
    );
    expect(agentExportsMigration.statements[0]).toContain(
      "idx_export_jobs_client_status",
    );
    expect(agentExportsMigration.statements[0]).toContain(
      "scope_snapshot_json",
    );
    expect(migrations.at(-1)).toBe(agentExportsMigration);
  });
});
