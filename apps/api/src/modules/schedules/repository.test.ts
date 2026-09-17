import { describe, expect, test } from "bun:test";
import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import type { DatabaseConnection, DatabasePort } from "@gezycbt/database";
import {
  type NormalizedCreateScheduleInput,
  ScheduleVersionConflictError,
} from "./domain";
import { SqlScheduleRepository } from "./repository";

const SCHEDULE = "40" as Id;
const REVISION = "30" as Id;
const VERSION = "2026-09-17T00:00:00.000Z" as UtcTimestamp;

describe("SqlScheduleRepository", () => {
  test("creates schedule and target rows in one transaction", async () => {
    const database = new FakeScheduleDatabase();
    const repository = new SqlScheduleRepository(database);
    const result = await repository.createSchedule(createInput());

    expect(result.id).toBe(SCHEDULE);
    expect(database.transactionCount).toBe(1);
    expect(
      database.statements.some((sql) =>
        sql.startsWith("INSERT INTO exam_schedules"),
      ),
    ).toBe(true);
    expect(
      database.statements.filter((sql) =>
        sql.startsWith("INSERT INTO exam_schedule_classes"),
      ).length,
    ).toBe(1);
    expect(
      database.statements.filter((sql) =>
        sql.startsWith("INSERT INTO exam_schedule_participants"),
      ).length,
    ).toBe(1);
  });

  test("reads schedule without exposing raw access digests", async () => {
    const database = new FakeScheduleDatabase();
    database.scheduleRow = {
      ...database.scheduleRow,
      practice_token_hash: new Uint8Array(32),
      has_practice_token: 1,
      main_access_code_hash: null,
      identity_fields_json: JSON.stringify([
        { key: "name", label: "Nama", type: "TEXT", required: true },
      ]),
    };
    database.classRows = [{ class_id: 50n }];
    database.participantRows = [{ participant_id: 60n }];
    const result = await new SqlScheduleRepository(database).findSchedule(
      SCHEDULE,
    );

    expect(result?.hasPracticeToken).toBe(true);
    expect(result?.practiceTokenHint).toBe("PRA1");
    expect(result?.identityFields?.[0]?.key).toBe("name");
    expect(JSON.stringify(result)).not.toContain("practice_token_hash");
  });

  test("uses optimistic locking for lifecycle transition", async () => {
    const database = new FakeScheduleDatabase();
    const repository = new SqlScheduleRepository(database);
    await expect(
      repository.transitionSchedule(
        SCHEDULE,
        "READY",
        "2026-09-17T00:00:01.000Z" as UtcTimestamp,
      ),
    ).rejects.toBeInstanceOf(ScheduleVersionConflictError);
    expect(database.statements.some((sql) => sql.includes("FOR UPDATE"))).toBe(
      true,
    );
    expect(
      database.statements.some((sql) => sql.includes("SET status = ?")),
    ).toBe(false);
  });

  test("updates an access digest and hint with optimistic locking", async () => {
    const database = new FakeScheduleDatabase();
    const digest = new Uint8Array(32).fill(4);
    const result = await new SqlScheduleRepository(database).updateAccessCode(
      SCHEDULE,
      "PRACTICE_TOKEN",
      digest,
      "•••-DE",
      VERSION,
    );

    expect(result?.hasPracticeToken).toBe(true);
    expect(result?.practiceTokenHint).toBe("•••-DE");
    expect(database.transactionCount).toBe(1);
    expect(
      database.statements.some((sql) =>
        sql.includes("practice_token_hash = ?"),
      ),
    ).toBe(true);
    expect(database.parameters.some(([value]) => value === digest)).toBe(true);
  });

  test("stores staff close reason and timestamp through the database clock", async () => {
    const database = new FakeScheduleDatabase();
    database.scheduleRow = { ...database.scheduleRow, status: "READY" };
    const result = await new SqlScheduleRepository(database).transitionSchedule(
      SCHEDULE,
      "CLOSED",
      VERSION,
      { closedByUserId: "11" as Id, closeReason: "Selesai" },
    );
    expect(result?.status).toBe("CLOSED");
    expect(
      database.statements.some((sql) =>
        sql.includes("closed_at = UTC_TIMESTAMP(6)"),
      ),
    ).toBe(true);
  });
});

class FakeScheduleDatabase implements DatabasePort {
  readonly statements: string[] = [];
  readonly parameters: unknown[][] = [];
  transactionCount = 0;
  scheduleRow: Record<string, unknown> = {
    id: 40n,
    exam_revision_id: 30n,
    exam_id: 31n,
    subject_id: 20n,
    owner_teacher_id: 10n,
    revision_status: "PUBLISHED",
    exam_status: "PUBLISHED",
    mode: "PRACTICE",
    status: "DRAFT",
    starts_at: "2026-09-17 01:00:00.000000",
    ends_at: "2026-09-17 03:00:00.000000",
    duration_seconds: 3600,
    max_attempts: 5,
    hard_end: 1,
    allow_late_start: 1,
    result_release_policy: "IMMEDIATE_SCORE",
    has_practice_token: 0,
    practice_token_hash: null,
    practice_token_hint: "PRA1",
    has_main_access_code: 0,
    main_access_code_hash: null,
    main_access_code_hint: null,
    identity_fields_json: null,
    closed_at: null,
    closed_by_user_id: null,
    close_reason: null,
    created_at: "2026-09-16 00:00:00.000000",
    updated_at: "2026-09-17 00:00:00.000000",
  };
  classRows: readonly { class_id: unknown }[] = [];
  participantRows: readonly { participant_id: unknown }[] = [];

  async query<T extends Record<string, unknown>>(
    sql: string,
    parameters: readonly unknown[] = [],
  ): Promise<readonly T[]> {
    this.statements.push(sql);
    this.parameters.push([...parameters]);
    if (sql.includes("FROM exam_schedules"))
      return [this.scheduleRow] as unknown as readonly T[];
    if (sql.includes("FROM exam_schedule_classes"))
      return this.classRows as unknown as readonly T[];
    if (sql.includes("FROM exam_schedule_participants"))
      return this.participantRows as unknown as readonly T[];
    if (sql.includes("SELECT id FROM classes"))
      return [{ id: 50n }] as unknown as readonly T[];
    if (sql.includes("SELECT id FROM users"))
      return [{ id: 60n }] as unknown as readonly T[];
    return [];
  }

  async execute(
    sql: string,
    parameters: readonly unknown[] = [],
  ): Promise<{ affectedRows: number; insertId?: bigint }> {
    this.statements.push(sql);
    this.parameters.push([...parameters]);
    if (sql.startsWith("INSERT INTO exam_schedules"))
      return { affectedRows: 1, insertId: 40n };
    if (sql.includes("practice_token_hash = ?")) {
      this.scheduleRow = {
        ...this.scheduleRow,
        practice_token_hash: parameters[0],
        practice_token_hint: parameters[1],
        has_practice_token: 1,
        updated_at: "2026-09-17 00:00:01.000000",
      };
    }
    if (sql.includes("SET status = 'CLOSED'")) {
      this.scheduleRow = {
        ...this.scheduleRow,
        status: "CLOSED",
        closed_at: "2026-09-17 02:00:00.000000",
        closed_by_user_id: 11n,
        close_reason: "Selesai",
      };
    }
    return { affectedRows: 1 };
  }

  async transaction<T>(
    operation: (connection: DatabaseConnection) => Promise<T>,
  ): Promise<T> {
    this.transactionCount += 1;
    return operation(this);
  }

  async close(): Promise<void> {}
}

function createInput(): NormalizedCreateScheduleInput {
  return {
    examRevisionId: REVISION,
    mode: "MAIN",
    startsAt: "2026-09-17T01:00:00.000Z" as UtcTimestamp,
    endsAt: "2026-09-17T03:00:00.000Z" as UtcTimestamp,
    durationSeconds: 3_600,
    maxAttempts: 1,
    hardEnd: true,
    allowLateStart: true,
    resultReleasePolicy: "MANUAL",
    identityFieldsJson: null,
    targetClassIds: ["50" as Id],
    targetParticipantIds: ["60" as Id],
  };
}
