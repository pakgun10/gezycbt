export type DatabaseErrorKind =
  | "UNIQUE"
  | "FOREIGN_KEY"
  | "CHECK"
  | "DEADLOCK"
  | "LOCK_TIMEOUT"
  | "CONNECTION"
  | "TIMEOUT"
  | "UNKNOWN";

export class NormalizedDatabaseError extends Error {
  constructor(
    readonly kind: DatabaseErrorKind,
    readonly vendorCode: string | undefined,
    message: string,
  ) {
    super(message);
  }
}

export interface DatabaseResult {
  readonly affectedRows: number;
  readonly insertId?: bigint;
}

export interface DatabaseConnection {
  query<T extends Record<string, unknown>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<readonly T[]>;
  execute(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<DatabaseResult>;
}

export interface DatabasePort extends DatabaseConnection {
  transaction<T>(
    operation: (connection: DatabaseConnection) => Promise<T>,
  ): Promise<T>;
  close(): Promise<void>;
}

export function normalizeDatabaseError(
  error: unknown,
): NormalizedDatabaseError {
  const candidate = error as {
    code?: unknown;
    errno?: unknown;
    message?: unknown;
  } | null;
  const code = String(candidate?.code ?? candidate?.errno ?? "");
  const message = String(candidate?.message ?? "Database operation failed");
  const kind =
    code === "ER_DUP_ENTRY" || code === "1062"
      ? "UNIQUE"
      : code === "ER_NO_REFERENCED_ROW_2" ||
          code === "1452" ||
          code === "ER_ROW_IS_REFERENCED_2" ||
          code === "1217"
        ? "FOREIGN_KEY"
        : code === "ER_CHECK_CONSTRAINT_VIOLATED" || code === "4025"
          ? "CHECK"
          : code === "ER_LOCK_DEADLOCK" ||
              code === "1213" ||
              /deadlock/i.test(message)
            ? "DEADLOCK"
            : code === "ER_LOCK_WAIT_TIMEOUT" ||
                code === "1205" ||
                /lock wait timeout/i.test(message)
              ? "LOCK_TIMEOUT"
              : /timeout/i.test(code) || /timeout/i.test(message)
                ? "TIMEOUT"
                : /connection|closed|socket|connect/i.test(code) ||
                    /connection|closed|socket|connect/i.test(message)
                  ? "CONNECTION"
                  : "UNKNOWN";
  return new NormalizedDatabaseError(kind, code || undefined, message);
}
