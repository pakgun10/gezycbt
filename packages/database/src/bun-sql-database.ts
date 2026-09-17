import { SQL } from "bun";
import type {
  DatabaseConnection,
  DatabasePort,
  DatabaseResult,
} from "./database-port";

type SqlClient = InstanceType<typeof SQL>;
type SqlExecutor = Pick<SqlClient, "unsafe">;

/** Runtime Bun.SQL adapter used by application repositories and CLI commands. */
export function createBunSqlDatabase(databaseUrl: string): DatabasePort {
  const url = new URL(databaseUrl);
  const client = new SQL({
    adapter: url.protocol === "mariadb:" ? "mariadb" : "mysql",
    hostname: url.hostname,
    port: Number(url.port || "3306"),
    database: decodeURIComponent(url.pathname.slice(1)),
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    max: 8,
    bigint: true,
  } as never);

  const connection = createConnection(client);
  return {
    ...connection,
    async transaction<T>(operation: (tx: DatabaseConnection) => Promise<T>) {
      return client.begin(async (transaction) =>
        operation(createConnection(transaction as unknown as SqlExecutor)),
      );
    },
    async close() {
      await client.close();
    },
  };
}

function createConnection(executor: SqlExecutor): DatabaseConnection {
  return {
    async query<T extends Record<string, unknown>>(
      sql: string,
      parameters: readonly unknown[] = [],
    ) {
      return (await executor.unsafe(sql, parameters)) as readonly T[];
    },
    async execute(
      sql: string,
      parameters: readonly unknown[] = [],
    ): Promise<DatabaseResult> {
      const result = (await executor.unsafe(sql, parameters)) as {
        affectedRows?: number | bigint;
        lastInsertRowid?: number | bigint;
      };
      const affectedRows = Number(result.affectedRows ?? 0);
      const insertId = result.lastInsertRowid;
      return {
        affectedRows,
        ...(insertId === undefined ? {} : { insertId: BigInt(insertId) }),
      };
    },
  };
}
