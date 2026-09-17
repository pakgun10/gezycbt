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
import { mediaMigration } from "./0010_media";
import { examsMigration } from "./0011_exams";
import { schedulesMigration } from "./0012_schedules";
import { examSessionsMigration } from "./0013_exam_sessions";
import { answersResultsMigration } from "./0014_answers_results";
import { attemptGrantsMigration } from "./0015_attempt_grants";
import { examSessionCredentialsMigration } from "./0016_exam_session_credentials";
import { exportsMigration } from "./0017_exports";

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
  mediaMigration,
  examsMigration,
  schedulesMigration,
  examSessionsMigration,
  answersResultsMigration,
  attemptGrantsMigration,
  examSessionCredentialsMigration,
  exportsMigration,
];
