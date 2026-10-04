import { formatUtcTimestamp, type UtcTimestamp } from "@gezycbt/contracts";
import { createBunSqlDatabase } from "@gezycbt/database";
import { AuthorizationPolicyService } from "../application/authorization";
import {
  ExamTimeoutFinalizer,
  SqlExamRuntimeStore,
} from "../modules/exam-sessions";
import { ExportService } from "../modules/exports";
import {
  FileSystemMediaStorage,
  SqlMediaRelationRepository,
} from "../modules/media";
import {
  ScheduleLifecycleReconciler,
  ScheduleService,
  SqlScheduleRepository,
} from "../modules/schedules";

export const JOB_NAMES = [
  "export",
  "finalize",
  "reconcile",
  "housekeeping",
] as const;
export type JobName = (typeof JOB_NAMES)[number];

export function parseJobName(value: string | undefined): JobName {
  if (value && (JOB_NAMES as readonly string[]).includes(value))
    return value as JobName;
  throw new Error(`Usage: jobs <${JOB_NAMES.join("|")}>`);
}

/** Idempotent, bounded commands used by systemd timers. */
export async function runJob(
  name: JobName,
): Promise<Readonly<Record<string, unknown>>> {
  const databaseUrl = Bun.env.GEZYCBT_DATABASE_URL ?? Bun.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("GEZYCBT_DATABASE_URL is required");
  const database = createBunSqlDatabase(databaseUrl);
  try {
    if (name === "export") {
      const ids = await new ExportService(database).runWorkerOnce(1);
      return { job: name, processed: ids.length, ids };
    }
    if (name === "finalize") {
      const ids = await new ExamTimeoutFinalizer(
        new SqlExamRuntimeStore(database),
      ).runOnce(formatUtcTimestamp(new Date()) as UtcTimestamp, 100);
      return { job: name, finalized: ids.length, ids };
    }
    if (name === "reconcile") {
      const repository = new SqlScheduleRepository(database);
      const schedules = new ScheduleService(
        repository,
        new AuthorizationPolicyService(async () => null),
      );
      const report = await new ScheduleLifecycleReconciler(
        repository,
        schedules,
        50,
      ).runOnce(
        { actor: { actorType: "SYSTEM", requestId: crypto.randomUUID() } },
        formatUtcTimestamp(new Date()) as UtcTimestamp,
      );
      return { job: name, ...report };
    }
    const result = await database.transaction(async (connection) => {
      const expiredExports = await connection.execute(
        `UPDATE export_jobs SET status = 'EXPIRED', updated_at = UTC_TIMESTAMP(6)
         WHERE status IN ('QUEUED', 'RUNNING') AND expires_at <= UTC_TIMESTAMP(6)`,
      );
      const expiredSessions = await connection.execute(
        `DELETE FROM auth_sessions
         WHERE revoked_at IS NOT NULL
            OR absolute_expires_at <= UTC_TIMESTAMP(6)`,
      );
      return {
        expiredExports: expiredExports.affectedRows,
        expiredSessions: expiredSessions.affectedRows,
      };
    });
    const mediaRoot =
      Bun.env.GEZYCBT_MEDIA_ROOT ??
      (Bun.env.APP_ENV === "production"
        ? "/var/lib/gezycbt/media"
        : ".data/media");
    const mediaRepository = new SqlMediaRelationRepository(database);
    const mediaStorage = new FileSystemMediaStorage(mediaRoot);
    const olderThan = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .replace("Z", "") as UtcTimestamp;
    const orphanAssets = (await mediaRepository.listOrphans({
      olderThan,
      limit: 100,
    })) as readonly import("../modules/media").MediaAsset[];
    let orphanMediaDeleted = 0;
    let orphanMediaCleanupFailures = 0;
    for (const asset of orphanAssets) {
      try {
        const deleted = await mediaRepository.deleteAsset(asset.id);
        if (!deleted) continue;
        try {
          await mediaStorage.remove(deleted.storageKey);
        } catch {
          await mediaRepository.restoreAsset?.(deleted.id);
          orphanMediaCleanupFailures += 1;
          continue;
        }
        orphanMediaDeleted += 1;
      } catch {
        orphanMediaCleanupFailures += 1;
      }
    }
    return {
      job: name,
      ...result,
      orphanMediaDeleted,
      orphanMediaCleanupFailures,
    };
  } finally {
    await database.close();
  }
}

if (import.meta.main) {
  runJob(parseJobName(Bun.argv[2]))
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "Job failed");
      process.exitCode = 1;
    });
}
