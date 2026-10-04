import type { Id } from "@gezycbt/contracts";
import { createBunSqlDatabase } from "@gezycbt/database";
import { SqlMediaRelationRepository } from "../modules/media";

/** Rebuilds canonical question hashes after the placement-table backfill. */
export async function rebuildQuestionHashes(
  databaseUrl: string,
): Promise<number> {
  const database = createBunSqlDatabase(databaseUrl);
  try {
    const repository = new SqlMediaRelationRepository(database);
    const rows = await database.query<{ id: unknown }>(
      "SELECT id FROM question_revisions ORDER BY id ASC",
    );
    let rebuilt = 0;
    for (const row of rows) {
      const id = String(row.id);
      if (!/^\d+$/u.test(id)) throw new Error("Invalid question revision ID");
      await repository.refreshRevisionHash(id as Id);
      rebuilt += 1;
    }
    return rebuilt;
  } finally {
    await database.close();
  }
}

async function main(): Promise<void> {
  const databaseUrl = Bun.env.GEZYCBT_DATABASE_URL ?? Bun.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("GEZYCBT_DATABASE_URL is required");
  const count = await rebuildQuestionHashes(databaseUrl);
  console.log(`Rebuilt ${count} question revision hash(es).`);
}

if (import.meta.main) {
  try {
    await main();
  } catch (error: unknown) {
    console.error(
      error instanceof Error ? error.message : "Hash rebuild failed",
    );
    process.exitCode = 1;
  }
}
