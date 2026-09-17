import { describe, expect, test } from "bun:test";
import { exportsMigration } from "./0017_exports";

describe("exports migration", () => {
  test("creates durable jobs and protected one-time files", () => {
    expect(exportsMigration.id).toBe("0017_exports");
    expect(exportsMigration.statements[0]).toContain(
      "CREATE TABLE export_jobs",
    );
    expect(exportsMigration.statements[0]).toContain(
      "idx_export_jobs_schedule_created",
    );
    expect(exportsMigration.statements[1]).toContain(
      "CREATE TABLE export_files",
    );
    expect(exportsMigration.statements[1]).toContain("download_token_digest");
  });
});
