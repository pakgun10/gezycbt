import { SQL } from "bun";
import type { MigrationDatabase } from "./migration-runner";

export interface BunSqlMigrationDatabase extends MigrationDatabase {
  close(): Promise<void>;
}

/** Creates the Bun.SQL adapter selected by ADR-003 for migration use only. */
export function createBunSqlMigrationDatabase(
  databaseUrl: string,
): BunSqlMigrationDatabase {
  const url = new URL(databaseUrl);
  const adapter = url.protocol === "mariadb:" ? "mariadb" : "mysql";
  const client = new SQL({
    adapter,
    hostname: url.hostname,
    port: Number(url.port || "3306"),
    database: decodeURIComponent(url.pathname.slice(1)),
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    max: 1,
  } as never);
  return {
    async query<T extends Record<string, unknown>>(
      sql: string,
      parameters: readonly unknown[] = [],
    ) {
      return (await client.unsafe(sql, parameters)) as readonly T[];
    },
    async execute(sql, parameters = []) {
      await client.unsafe(sql, parameters);
    },
    async close() {
      await client.close();
    },
  };
}
