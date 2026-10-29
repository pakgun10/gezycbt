/**
 * Table inventory for the admin backup file.
 *
 * BACKUP_TABLES is the insert order used by restore. It follows foreign-key
 * order (parents before children) as a first defence; restore additionally
 * runs with FOREIGN_KEY_CHECKS=0 inside one transaction, the same approach a
 * mysqldump restore uses, so a missed edge cannot silently corrupt data.
 *
 * CLEAR_TABLES are transient tables that are deliberately NOT in the backup
 * file. On restore their rows are deleted so the target does not keep stale
 * sessions, one-time tokens, or export artefacts from the old server:
 * - auth_sessions / auth_throttles: login state must not survive a move.
 * - system_locks: re-seeded with the single ADMIN_BOOTSTRAP row after clear,
 *   so the one-time admin bootstrap guard keeps its meaning.
 * - user_import_previews / rows / credential_artifacts: in-flight imports
 *   and their encrypted credential payloads are not portable data.
 * - integration_credentials: only digests are stored and the plaintext token
 *   cannot be recreated, so agent credentials must be re-issued after a move.
 * - integration_idempotency_keys: in-flight request deduplication state.
 * - export_jobs / export_files: derived outputs; they can be regenerated and
 *   their blobs would otherwise bloat every backup.
 *
 * SCHEMA_VERSION is the latest migration id (0024). A backup whose schema is
 * newer than the target is refused; an older one is accepted and the target
 * must run forward migrations afterwards, exactly like the ops restore flow.
 */
export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_MARKER = "gezycbt-backup";
export const SCHEMA_VERSION = 24;

export const BACKUP_TABLES: readonly string[] = [
  "school_settings",
  "users",
  "academic_years",
  "classes",
  "class_members",
  "subjects",
  "teacher_subjects",
  "teacher_classes",
  "question_banks",
  "questions",
  "question_revisions",
  "question_options",
  "true_false_statements",
  "media_assets",
  "question_revision_media",
  "question_media_placements",
  "exams",
  "exam_revisions",
  "exam_questions",
  "exam_schedules",
  "exam_schedule_classes",
  "exam_schedule_participants",
  "exam_sessions",
  "exam_session_questions",
  "answers",
  "exam_results",
  "exam_attempt_grants",
  "exam_regrade_runs",
  "exam_regrade_items",
  "integration_clients",
  "integration_grants",
  "agent_action_requests",
  "agent_action_approvals",
  "audit_logs",
];

export const CLEAR_TABLES: readonly string[] = [
  "auth_sessions",
  "auth_throttles",
  "system_locks",
  "user_import_previews",
  "user_import_preview_rows",
  "user_import_credential_artifacts",
  "integration_credentials",
  "integration_idempotency_keys",
  "export_jobs",
  "export_files",
];

export const KNOWN_TABLES: ReadonlySet<string> = new Set([
  ...BACKUP_TABLES,
  ...CLEAR_TABLES,
]);
