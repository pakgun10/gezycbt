import { describe, expect, test } from "bun:test";
import type { DatabasePort } from "@gezycbt/database";
import { instrumentDatabase } from "./database";
import { createMetrics, renderMetrics } from "./metrics";

describe("database observability", () => {
  test("records bounded query labels and transaction wait without SQL payload", async () => {
    const database: DatabasePort = {
      async query<T extends Record<string, unknown>>() {
        return [{ ready: 1 }] as unknown as T[];
      },
      async execute() {
        return { affectedRows: 1 };
      },
      async transaction(operation) {
        return operation(this);
      },
      async close() {},
    };
    const metrics = createMetrics();
    const observed = instrumentDatabase(database, metrics);
    await observed.query("SELECT secret FROM users WHERE id = ?", ["1"]);
    await observed.transaction((connection) =>
      connection.execute("UPDATE users SET display_name = ?", ["safe"]),
    );
    const output = renderMetrics(metrics, Date.now());
    expect(output).toContain('query="SELECT_users"');
    expect(output).toContain('query="UPDATE_users"');
    expect(output).not.toContain("secret");
    expect(output).not.toContain("display_name");
  });
});
