import { describe, expect, test } from "bun:test";
import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import { ExportService } from "./service";

const NOW = "2026-09-17T00:00:00.000Z" as UtcTimestamp;
const FUTURE = "2099-09-17T00:00:00.000Z" as UtcTimestamp;

function jobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "80",
    requester_user_id: "40",
    integration_client_id: "91",
    integration_grant_version: 3,
    schedule_id: "70",
    format: "CSV",
    status: "QUEUED",
    include_pii: 0,
    row_count: null,
    error_message: null,
    created_at: NOW,
    expires_at: FUTURE,
    scope_snapshot_json: JSON.stringify({ scheduleId: "70" }),
    filter_json: JSON.stringify({}),
    columns_json: JSON.stringify(["id", "participantName"]),
    row_limit: 100,
    ...overrides,
  };
}

function setup() {
  const statements: string[] = [];
  let insertId = 80n;
  const database = {
    async query<T extends Record<string, unknown>>(sql: string) {
      statements.push(sql);
      if (sql.includes("FROM export_jobs") && sql.includes("WHERE id = ?"))
        return [jobRow()] as unknown as T[];
      if (sql.includes("FROM export_files"))
        return [
          { format: "CSV", content_blob: new TextEncoder().encode("ok") },
        ] as unknown as T[];
      return [] as T[];
    },
    async execute(sql: string) {
      statements.push(sql);
      if (sql.startsWith("INSERT INTO export_jobs"))
        return { affectedRows: 1, insertId: insertId++ };
      if (sql.startsWith("UPDATE export_jobs SET status = 'RUNNING'"))
        return { affectedRows: 0 };
      return { affectedRows: 1 };
    },
    async transaction<T>(operation: (connection: never) => Promise<T>) {
      return operation(database as never);
    },
    async close() {},
  };
  return {
    service: new ExportService(database as never),
    statements,
  };
}

describe("export service", () => {
  test("creates a queued job with bounded columns and schedules the worker", async () => {
    const value = setup();
    const job = await value.service.createJob({
      requesterUserId: "40" as Id,
      scheduleId: "70" as Id,
      format: "CSV",
      includePii: false,
      integrationClientId: "91" as Id,
      columns: ["id", "participantName"],
      rowLimit: 100,
    });
    expect(job).toMatchObject({
      id: "80",
      status: "QUEUED",
      includePii: false,
      expiresAt: FUTURE,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      value.statements.some((statement) =>
        statement.includes("SET status = 'RUNNING'"),
      ),
    ).toBe(true);
  });

  test("consumes a download token through a compare-and-set transaction", async () => {
    const value = setup();
    const database = value.service;
    const result = await database.consumeDownload("80" as Id, "token");
    expect(result.jobId).toBe("80" as Id);
    expect(result.format).toBe("CSV");
  });
});
