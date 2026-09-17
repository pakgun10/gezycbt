import {
  createBunSqlMigrationDatabase,
  migrations,
  runMigrations,
} from "@gezycbt/database";

const DEFAULT_LOCK_TIMEOUT_SECONDS = 30;

export interface MigrationCliOptions {
  readonly databaseUrl: string;
  readonly release: string;
  readonly lockTimeoutSeconds: number;
}

export function readMigrationCliOptions(
  env: Readonly<Record<string, string | undefined>>,
): MigrationCliOptions {
  const databaseUrl = env.GEZYCBT_DATABASE_URL ?? env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("GEZYCBT_DATABASE_URL is required for migration");
  }
  const lockTimeoutSeconds = parseLockTimeout(
    env.MIGRATION_LOCK_TIMEOUT_SECONDS,
  );
  return {
    databaseUrl,
    release: env.APP_RELEASE?.trim() || "manual",
    lockTimeoutSeconds,
  };
}

function parseLockTimeout(value: string | undefined): number {
  if (value === undefined || value.trim() === "")
    return DEFAULT_LOCK_TIMEOUT_SECONDS;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 300) {
    throw new Error(
      "MIGRATION_LOCK_TIMEOUT_SECONDS must be an integer between 1 and 300",
    );
  }
  return parsed;
}

async function main(): Promise<void> {
  const options = readMigrationCliOptions(Bun.env);
  const database = createBunSqlMigrationDatabase(options.databaseUrl);
  try {
    await runMigrations(database, migrations, {
      lockName: "GEZYCBT_SCHEMA_MIGRATION",
      lockTimeoutSeconds: options.lockTimeoutSeconds,
      release: options.release,
    });
    console.log(
      `Database migrations applied (${migrations.length} known migration${migrations.length === 1 ? "" : "s"}).`,
    );
  } finally {
    await database.close();
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : "Migration failed");
    process.exitCode = 1;
  }
}
