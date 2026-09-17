import type { Migration } from "../migration-runner";

/** Forward-only additions for isolated guest resume credentials and CAS. */
export const examSessionCredentialsMigration: Migration = {
  id: "0016_exam_session_credentials",
  statements: [
    "ALTER TABLE exam_sessions ADD COLUMN practice_session_credential_hash BINARY(32) NULL AFTER practice_access_token_hash",
    "ALTER TABLE exam_sessions ADD COLUMN version INT UNSIGNED NOT NULL DEFAULT 1 AFTER last_seen_at",
    "ALTER TABLE exam_sessions ADD CONSTRAINT chk_exam_sessions_version CHECK (version > 0)",
  ],
};
