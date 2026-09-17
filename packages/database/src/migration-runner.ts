export interface Migration {
  readonly id: string;
  readonly statements: readonly string[];
}

export interface MigrationDatabase {
  query<T extends Record<string, unknown>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<readonly T[]>;
  execute(sql: string, parameters?: readonly unknown[]): Promise<void>;
}

export interface MigrationRunOptions {
  readonly lockName: string;
  readonly lockTimeoutSeconds: number;
  readonly release: string;
}

export async function runMigrations(
  database: MigrationDatabase,
  migrations: readonly Migration[],
  options: MigrationRunOptions,
): Promise<void> {
  validateMigrations(migrations);
  const lock = await database.query<{ acquired: number }>(
    "SELECT GET_LOCK(?, ?) AS acquired",
    [options.lockName, options.lockTimeoutSeconds],
  );
  if (lock[0]?.acquired !== 1) throw new Error("Migration lock is unavailable");
  try {
    await database.execute(`CREATE TABLE IF NOT EXISTS schema_migrations (
      id VARCHAR(191) NOT NULL PRIMARY KEY,
      checksum CHAR(64) NOT NULL,
      applied_at DATETIME(6) NOT NULL,
      duration_ms INT UNSIGNED NOT NULL,
      release_id VARCHAR(191) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    const applied = await database.query<{ id: string; checksum: string }>(
      "SELECT id, checksum FROM schema_migrations",
    );
    const appliedById = new Map(applied.map((row) => [row.id, row.checksum]));
    for (const migration of migrations) {
      const checksum = await sha256(
        migration.statements.join("\n-- gezycbt statement boundary\n"),
      );
      const previous = appliedById.get(migration.id);
      if (previous === checksum) continue;
      if (previous)
        throw new Error(`Applied migration checksum changed: ${migration.id}`);
      const started = performance.now();
      for (const statement of migration.statements)
        await database.execute(statement);
      await database.execute(
        "INSERT INTO schema_migrations (id, checksum, applied_at, duration_ms, release_id) VALUES (?, ?, UTC_TIMESTAMP(6), ?, ?)",
        [
          migration.id,
          checksum,
          Math.round(performance.now() - started),
          options.release,
        ],
      );
    }
  } finally {
    await database.query("SELECT RELEASE_LOCK(?) AS released", [
      options.lockName,
    ]);
  }
}

function validateMigrations(migrations: readonly Migration[]): void {
  const ids = new Set<string>();
  for (const migration of migrations) {
    if (!/^[0-9]{4,}_[a-z0-9_]+$/.test(migration.id))
      throw new Error(`Invalid migration ID: ${migration.id}`);
    if (ids.has(migration.id))
      throw new Error(`Duplicate migration ID: ${migration.id}`);
    if (
      migration.statements.length === 0 ||
      migration.statements.some((statement) => !statement.trim())
    )
      throw new Error(`Migration has no usable SQL: ${migration.id}`);
    ids.add(migration.id);
  }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
