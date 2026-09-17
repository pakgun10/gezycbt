import type { Migration } from "../migration-runner";
import { identityMigration } from "./0001_identity";
import { academicMigration } from "./0002_academic";
import { subjectsMigration } from "./0003_subjects";
import { systemLocksMigration } from "./0004_system_locks";
import { userImportPreviewsMigration } from "./0005_user_import_previews";
import { importCommitMigration } from "./0006_import_commit";
import { authThrottlesMigration } from "./0007_auth_throttles";
import { questionBanksMigration } from "./0008_question_banks";
import { questionOptionsMigration } from "./0009_question_options";

export const migrations: readonly Migration[] = [
  identityMigration,
  academicMigration,
  subjectsMigration,
  systemLocksMigration,
  userImportPreviewsMigration,
  importCommitMigration,
  authThrottlesMigration,
  questionBanksMigration,
  questionOptionsMigration,
];
