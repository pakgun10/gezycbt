import type { DatabaseConnection, DatabasePort } from "@gezycbt/database";
import { type Metrics, recordPoolWait, recordQuery } from "./metrics";

/** Adds bounded query timing around the database port without logging SQL. */
export function instrumentDatabase(
  database: DatabasePort,
  metrics: Metrics,
): DatabasePort {
  return {
    query: (sql, parameters) => timedQuery(database, metrics, sql, parameters),
    execute: (sql, parameters) =>
      timedExecute(database, metrics, sql, parameters),
    transaction: async <T>(
      operation: (connection: DatabaseConnection) => Promise<T>,
    ) => {
      const started = performance.now();
      const result = await database.transaction(async (connection) => {
        if (performance.now() - started > 5) recordPoolWait(metrics);
        return operation(instrumentConnection(connection, metrics));
      });
      return result;
    },
    close: () => database.close(),
  };
}

function instrumentConnection(
  connection: DatabaseConnection,
  metrics: Metrics,
): DatabaseConnection {
  return {
    query: (sql, parameters) =>
      timedQuery(connection, metrics, sql, parameters),
    execute: (sql, parameters) =>
      timedExecute(connection, metrics, sql, parameters),
  };
}

async function timedQuery<T extends Record<string, unknown>>(
  connection: Pick<DatabaseConnection, "query">,
  metrics: Metrics,
  sql: string,
  parameters?: readonly unknown[],
): Promise<readonly T[]> {
  const started = performance.now();
  try {
    return await connection.query<T>(sql, parameters);
  } finally {
    recordQuery(metrics, sql, performance.now() - started);
  }
}

async function timedExecute(
  connection: Pick<DatabaseConnection, "execute">,
  metrics: Metrics,
  sql: string,
  parameters?: readonly unknown[],
) {
  const started = performance.now();
  try {
    return await connection.execute(sql, parameters);
  } finally {
    recordQuery(metrics, sql, performance.now() - started);
  }
}
