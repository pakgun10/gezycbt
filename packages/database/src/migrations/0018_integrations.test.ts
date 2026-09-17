import { describe, expect, test } from "bun:test";
import { integrationsMigration } from "./0018_integrations";

describe("integrations migration", () => {
  test("creates machine clients, digests, grants, and replay protection", () => {
    expect(integrationsMigration.id).toBe("0018_integrations");
    expect(integrationsMigration.statements).toHaveLength(4);
    expect(integrationsMigration.statements[0]).toContain(
      "CREATE TABLE integration_clients",
    );
    expect(integrationsMigration.statements[1]).toContain(
      "token_digest BINARY(32)",
    );
    expect(integrationsMigration.statements[2]).toContain("grant_version");
    expect(integrationsMigration.statements[3]).toContain(
      "uq_integration_idempotency_client_key",
    );
  });
});
