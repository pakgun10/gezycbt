import { describe, expect, test } from "bun:test";
import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import type { UseCaseContext } from "../../application/actor-context";
import type { TeacherScopedResource } from "../../application/authorization";
import {
  createHmacScheduleAccessCodeHasher,
  formatHint,
  generateScheduleAccessCode,
  normalizeScheduleAccessCode,
  ScheduleAccessCodeConflictError,
  type ScheduleAccessCodeHasher,
  ScheduleAccessCodeModeError,
  ScheduleAccessCodeService,
} from "./access-code";
import type { Schedule } from "./domain";
import type {
  ScheduleAccessField,
  ScheduleAccessRepository,
} from "./repository";

const SCHEDULE = "40" as Id;
const TEACHER = "10" as Id;
const VERSION = "2026-09-17T00:00:00.000Z" as UtcTimestamp;
const NEXT_VERSION = "2026-09-17T00:00:01.000Z" as UtcTimestamp;

const CONTEXT: UseCaseContext = {
  actor: {
    actorType: "HUMAN",
    userId: TEACHER,
    role: "TEACHER",
    active: true,
    requestId: "access-code-request-001",
  },
  idempotencyKey: "access-code-idempotency-001",
};

describe("schedule access codes", () => {
  test("normalizes case and display hyphens, while rejecting ambiguous characters", () => {
    expect(normalizeScheduleAccessCode(" ab-cdE ")).toBe("ABCDE");
    expect(normalizeScheduleAccessCode("ABCDE-")).toBe("ABCDE");
    expect(() => normalizeScheduleAccessCode("ABCD0")).toThrow();
    expect(() => normalizeScheduleAccessCode("ABCDI")).toThrow();
    expect(formatHint("ABCDE")).toBe("•••-DE");
  });

  test("generates exactly five characters from the unambiguous alphabet", () => {
    const code = generateScheduleAccessCode();
    expect(code).toHaveLength(5);
    expect(() => normalizeScheduleAccessCode(code)).not.toThrow();
  });

  test("uses keyed HMAC and returns plaintext only in the rotation result", async () => {
    const hasher = createHmacScheduleAccessCodeHasher({
      secret: new Uint8Array(32).fill(7),
    });
    const first = await hasher.digest("PRACTICE_TOKEN", "ABCDE");
    const second = await hasher.digest("PRACTICE_TOKEN", "ABCDE");
    const different = await hasher.digest("MAIN_ACCESS_CODE", "ABCDE");
    expect(first).toHaveLength(32);
    expect([...first]).toEqual([...second]);
    expect([...first]).not.toEqual([...different]);
  });

  test("rotates a proposed practice token atomically and keeps only its safe hint", async () => {
    const repository = new FakeAccessRepository();
    const service = new ScheduleAccessCodeService(
      repository,
      new FakeAuthorization(),
      { hasher: new FakeHasher() },
    );
    const result = await service.rotatePracticeToken(
      CONTEXT,
      SCHEDULE,
      VERSION,
      "ab-cde",
    );

    expect(result).toMatchObject({
      scheduleId: SCHEDULE,
      kind: "PRACTICE_TOKEN",
      code: "ABCDE",
      hint: "•••-DE",
      updatedAt: NEXT_VERSION,
    });
    expect(repository.field).toBe("PRACTICE_TOKEN");
    expect(repository.hint).toBe("•••-DE");
    expect(repository.digest).toHaveLength(32);
  });

  test("generates a server code and retries only generated-code collisions", async () => {
    const repository = new FakeAccessRepository();
    repository.schedule = {
      ...repository.schedule,
      mode: "MAIN",
      resultReleasePolicy: "MANUAL",
      maxAttempts: 1,
      hasPracticeToken: false,
    };
    repository.conflictCount = 1;
    let generated = 0;
    const service = new ScheduleAccessCodeService(
      repository,
      new FakeAuthorization(),
      {
        hasher: new FakeHasher(),
        generateCode: () => {
          generated += 1;
          return generated === 1 ? "ABCDE" : "FGHJK";
        },
      },
    );
    const result = await service.rotateMainAccessCode(
      CONTEXT,
      SCHEDULE,
      VERSION,
    );
    expect(result.code).toBe("FGHJK");
    expect(repository.calls).toBe(2);

    repository.conflictCount = 1;
    await expect(
      service.rotateMainAccessCode(CONTEXT, SCHEDULE, VERSION, "ABCDE"),
    ).rejects.toBeInstanceOf(ScheduleAccessCodeConflictError);
    expect(repository.calls).toBe(3);
  });

  test("does not permit a code for the wrong schedule mode or a closed schedule", async () => {
    const repository = new FakeAccessRepository();
    const service = new ScheduleAccessCodeService(
      repository,
      new FakeAuthorization(),
      { hasher: new FakeHasher() },
    );
    await expect(
      service.rotateMainAccessCode(CONTEXT, SCHEDULE, VERSION, "ABCDE"),
    ).rejects.toBeInstanceOf(ScheduleAccessCodeModeError);
    repository.schedule = {
      ...repository.schedule,
      mode: "PRACTICE",
      status: "CLOSED",
    };
    await expect(
      service.rotatePracticeToken(CONTEXT, SCHEDULE, VERSION, "ABCDE"),
    ).rejects.toThrow("cannot be changed");
  });

  test("rejects a malformed digest before repository mutation", async () => {
    const repository = new FakeAccessRepository();
    const service = new ScheduleAccessCodeService(
      repository,
      new FakeAuthorization(),
      {
        hasher: {
          async digest(): Promise<Uint8Array> {
            return new Uint8Array(31);
          },
        },
      },
    );
    await expect(
      service.rotatePracticeToken(CONTEXT, SCHEDULE, VERSION, "ABCDE"),
    ).rejects.toMatchObject({ code: "INVALID_ACCESS_CODE_DIGEST" });
    expect(repository.calls).toBe(0);
  });
});

class FakeHasher implements ScheduleAccessCodeHasher {
  async digest(): Promise<Uint8Array> {
    return new Uint8Array(32).fill(9);
  }
}

class FakeAuthorization {
  async assertTeacherScope(
    _actor: UseCaseContext["actor"],
    _resource: TeacherScopedResource,
  ): Promise<void> {}
}

class FakeAccessRepository
  implements Pick<ScheduleAccessRepository, "updateAccessCode">
{
  schedule = createSchedule();
  field: ScheduleAccessField | null = null;
  digest: Uint8Array | null = null;
  hint: string | null = null;
  calls = 0;
  conflictCount = 0;

  async findSchedule(_id: Id): Promise<Schedule | null> {
    return this.schedule;
  }

  async updateAccessCode(
    _id: Id,
    field: ScheduleAccessField,
    digest: Uint8Array,
    hint: string,
    _expectedUpdatedAt: UtcTimestamp,
  ): Promise<Schedule | null> {
    this.calls += 1;
    if (this.conflictCount > 0) {
      this.conflictCount -= 1;
      throw new ScheduleAccessCodeConflictError();
    }
    this.field = field;
    this.digest = digest;
    this.hint = hint;
    this.schedule = { ...this.schedule, updatedAt: NEXT_VERSION };
    return this.schedule;
  }
}

function createSchedule(): Schedule {
  return {
    id: SCHEDULE,
    examRevisionId: "30" as Id,
    exam: {
      id: "30" as Id,
      examId: "31" as Id,
      subjectId: "20" as Id,
      ownerTeacherId: TEACHER,
      revisionStatus: "PUBLISHED",
      examStatus: "PUBLISHED",
    },
    mode: "PRACTICE",
    status: "DRAFT",
    startsAt: "2026-09-17T01:00:00.000Z" as UtcTimestamp,
    endsAt: "2026-09-17T03:00:00.000Z" as UtcTimestamp,
    durationSeconds: 3_600,
    maxAttempts: 5,
    hardEnd: true,
    allowLateStart: true,
    resultReleasePolicy: "IMMEDIATE_SCORE",
    hasPracticeToken: false,
    practiceTokenHint: null,
    hasMainAccessCode: false,
    mainAccessCodeHint: null,
    identityFields: null,
    targetClassIds: [],
    targetParticipantIds: [],
    closedAt: null,
    closedByUserId: null,
    closeReason: null,
    createdAt: "2026-09-16T00:00:00.000Z" as UtcTimestamp,
    updatedAt: VERSION,
  };
}
