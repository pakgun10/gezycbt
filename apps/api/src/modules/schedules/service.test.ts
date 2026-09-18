import { describe, expect, test } from "bun:test";
import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import type { UseCaseContext } from "../../application/actor-context";
import type { TeacherScopedResource } from "../../application/authorization";
import {
  type NormalizedCreateScheduleInput,
  type NormalizedUpdateScheduleInput,
  type Schedule,
  type ScheduleExamReference,
  ScheduleExamRevisionNotPublishedError,
  ScheduleImmutableError,
  ScheduleNotReadyError,
  ScheduleTransitionError,
  ScheduleValidationError,
  ScheduleVersionConflictError,
  ScheduleWindowError,
} from "./domain";
import type {
  ScheduleRepository,
  ScheduleTransitionOptions,
} from "./repository";
import { ScheduleService } from "./service";

const TEACHER = "10" as Id;
const ADMIN = "11" as Id;
const SUBJECT = "20" as Id;
const REVISION = "30" as Id;
const SCHEDULE = "40" as Id;
const CLASS = "50" as Id;
const NOW = "2026-09-17T02:00:00.000Z" as UtcTimestamp;
const STARTS = "2026-09-17T01:00:00.000Z" as UtcTimestamp;
const ENDS = "2026-09-17T03:00:00.000Z" as UtcTimestamp;
const VERSION = "2026-09-17T00:00:00.000Z" as UtcTimestamp;
const NEXT_VERSION = "2026-09-17T00:00:01.000Z" as UtcTimestamp;

const TEACHER_CONTEXT: UseCaseContext = {
  actor: {
    actorType: "HUMAN",
    userId: TEACHER,
    role: "TEACHER",
    active: true,
    requestId: "schedule-request-001",
  },
  idempotencyKey: "schedule-idempotency-001",
};

const ADMIN_CONTEXT: UseCaseContext = {
  actor: {
    actorType: "HUMAN",
    userId: ADMIN,
    role: "ADMIN",
    active: true,
    requestId: "schedule-request-002",
  },
  idempotencyKey: "schedule-idempotency-002",
};

describe("ScheduleService", () => {
  test("creates a draft schedule only for a published revision in teacher scope", async () => {
    const repository = new FakeScheduleRepository();
    const authorization = new FakeAuthorization();
    const service = new ScheduleService(repository, authorization);

    const result = await service.createSchedule(TEACHER_CONTEXT, {
      examRevisionId: REVISION,
      mode: "MAIN",
      startsAt: STARTS,
      endsAt: ENDS,
      durationSeconds: 3_600,
      maxAttempts: 1,
      hardEnd: true,
      allowLateStart: true,
      resultReleasePolicy: "MANUAL",
      targetClassIds: [CLASS],
    });

    expect(result.status).toBe("DRAFT");
    expect(repository.created?.targetClassIds).toEqual([CLASS]);
    expect(authorization.resources).toEqual([
      { ownerTeacherId: TEACHER, subjectId: SUBJECT, classIds: [CLASS] },
    ]);
  });

  test("rejects an unpublished revision before persistence", async () => {
    const repository = new FakeScheduleRepository();
    repository.examRevision = {
      ...repository.examRevision,
      revisionStatus: "DRAFT",
    };
    const service = new ScheduleService(repository, new FakeAuthorization());

    await expect(
      service.createSchedule(TEACHER_CONTEXT, {
        examRevisionId: REVISION,
        mode: "MAIN",
        startsAt: STARTS,
        endsAt: ENDS,
        durationSeconds: 60,
        maxAttempts: 1,
        allowLateStart: true,
        resultReleasePolicy: "MANUAL",
      }),
    ).rejects.toBeInstanceOf(ScheduleExamRevisionNotPublishedError);
    expect(repository.created).toBeNull();
  });

  test("enforces mode-specific target, attempt, release, and hard-stop invariants", async () => {
    const repository = new FakeScheduleRepository();
    const service = new ScheduleService(repository, new FakeAuthorization());

    await expect(
      service.createSchedule(TEACHER_CONTEXT, {
        examRevisionId: REVISION,
        mode: "MAIN",
        startsAt: STARTS,
        endsAt: "2026-09-17T01:30:00.000Z" as UtcTimestamp,
        durationSeconds: 3_600,
        maxAttempts: 1,
        allowLateStart: true,
        resultReleasePolicy: "MANUAL",
      }),
    ).rejects.toMatchObject({ code: "DURATION_EXCEEDS_WINDOW" });

    await expect(
      service.createSchedule(TEACHER_CONTEXT, {
        examRevisionId: REVISION,
        mode: "PRACTICE",
        startsAt: STARTS,
        endsAt: ENDS,
        durationSeconds: 600,
        maxAttempts: 3,
        allowLateStart: true,
        resultReleasePolicy: "IMMEDIATE_SCORE",
        targetParticipantIds: ["60" as Id],
      }),
    ).rejects.toMatchObject({ code: "PRACTICE_TARGETS_FORBIDDEN" });

    await expect(
      service.createSchedule(TEACHER_CONTEXT, {
        examRevisionId: REVISION,
        mode: "MAIN",
        startsAt: STARTS,
        endsAt: ENDS,
        durationSeconds: 600,
        maxAttempts: 2,
        allowLateStart: true,
        resultReleasePolicy: "MANUAL",
      }),
    ).rejects.toMatchObject({ code: "MAIN_ATTEMPT_MUST_BE_ONE" });
  });

  test("updates only drafts with an expected timestamp and revalidates merged policy", async () => {
    const repository = new FakeScheduleRepository();
    const service = new ScheduleService(repository, new FakeAuthorization());
    const updated = await service.updateSchedule(
      TEACHER_CONTEXT,
      SCHEDULE,
      { endsAt: "2026-09-17T04:00:00.000Z" as UtcTimestamp },
      VERSION,
    );
    expect(updated.endsAt).toBe("2026-09-17T04:00:00.000Z" as UtcTimestamp);
    expect(repository.updateExpected).toBe(VERSION);

    await expect(
      service.updateSchedule(
        TEACHER_CONTEXT,
        SCHEDULE,
        { maxAttempts: 1 },
        NEXT_VERSION,
      ),
    ).rejects.toBeInstanceOf(ScheduleVersionConflictError);
    repository.schedule = { ...repository.schedule, status: "OPEN" };
    await expect(
      service.updateSchedule(
        TEACHER_CONTEXT,
        SCHEDULE,
        { allowLateStart: false },
        VERSION,
      ),
    ).rejects.toBeInstanceOf(ScheduleImmutableError);
  });

  test("requires complete access and target policy before READY, then enforces the window for OPEN", async () => {
    const repository = new FakeScheduleRepository();
    repository.schedule = { ...repository.schedule, hasMainAccessCode: false };
    const service = new ScheduleService(repository, new FakeAuthorization());

    await expect(
      service.transitionSchedule(
        TEACHER_CONTEXT,
        SCHEDULE,
        "READY",
        VERSION,
        NOW,
      ),
    ).rejects.toBeInstanceOf(ScheduleNotReadyError);

    repository.schedule = { ...repository.schedule, hasMainAccessCode: true };
    const ready = await service.transitionSchedule(
      TEACHER_CONTEXT,
      SCHEDULE,
      "READY",
      VERSION,
      NOW,
    );
    expect(ready.status).toBe("READY");

    await expect(
      service.transitionSchedule(
        TEACHER_CONTEXT,
        SCHEDULE,
        "OPEN",
        NEXT_VERSION,
        "2026-09-17T00:30:00.000Z" as UtcTimestamp,
      ),
    ).rejects.toBeInstanceOf(ScheduleWindowError);
  });

  test("closes with a required reason and archives only as admin", async () => {
    const repository = new FakeScheduleRepository();
    repository.schedule = { ...repository.schedule, status: "READY" };
    const service = new ScheduleService(repository, new FakeAuthorization());

    await expect(
      service.closeSchedule(TEACHER_CONTEXT, SCHEDULE, VERSION, "", NOW),
    ).rejects.toBeInstanceOf(ScheduleValidationError);
    const closed = await service.closeSchedule(
      TEACHER_CONTEXT,
      SCHEDULE,
      VERSION,
      "Jadwal ditutup oleh guru",
      NOW,
    );
    expect(closed.status).toBe("CLOSED");
    expect(repository.transitionOptions).toEqual({
      closedByUserId: TEACHER,
      closeReason: "Jadwal ditutup oleh guru",
    });

    repository.schedule = { ...closed, updatedAt: NEXT_VERSION };
    await expect(
      service.archiveSchedule(TEACHER_CONTEXT, SCHEDULE, NEXT_VERSION),
    ).rejects.toBeInstanceOf(ScheduleTransitionError);
    const archived = await service.archiveSchedule(
      ADMIN_CONTEXT,
      SCHEDULE,
      NEXT_VERSION,
    );
    expect(archived.status).toBe("ARCHIVED");
  });

  test("system lifecycle advancement opens in-window schedules and auto-closes expired ones", async () => {
    const repository = new FakeScheduleRepository();
    repository.schedule = { ...repository.schedule, status: "READY" };
    const service = new ScheduleService(repository, new FakeAuthorization());
    const systemContext: UseCaseContext = {
      actor: { actorType: "SYSTEM", requestId: "schedule-system-001" },
    };
    const opened = await service.advanceLifecycle(systemContext, SCHEDULE, NOW);
    expect(opened?.status).toBe("OPEN");
    expect(repository.transitionOptions).toEqual(undefined);

    if (!opened) throw new Error("Expected schedule to be opened");
    repository.schedule = {
      ...opened,
      status: "OPEN",
      updatedAt: NEXT_VERSION,
    };
    const closed = await service.advanceLifecycle(
      systemContext,
      SCHEDULE,
      "2026-09-17T04:00:00.000Z" as UtcTimestamp,
    );
    expect(closed?.status).toBe("CLOSED");
    expect(repository.transitionOptions).toEqual({
      closedByUserId: null,
      closeReason: null,
    });
  });
});

class FakeAuthorization {
  readonly resources: TeacherScopedResource[] = [];

  async assertTeacherScope(
    actor: { readonly role?: string; readonly userId?: Id },
    resource: TeacherScopedResource,
  ): Promise<void> {
    if (actor.role === "TEACHER" && resource.ownerTeacherId !== actor.userId)
      throw new Error("scope denied");
    this.resources.push(resource);
  }

  assertAdmin(actor: { readonly role?: string }): void {
    if (actor.role !== "ADMIN")
      throw new ScheduleTransitionError("admin required", "ADMIN_REQUIRED");
  }
}

class FakeScheduleRepository implements ScheduleRepository {
  examRevision: ScheduleExamReference = {
    id: REVISION,
    examId: "31" as Id,
    subjectId: SUBJECT,
    ownerTeacherId: TEACHER,
    revisionStatus: "PUBLISHED",
    examStatus: "PUBLISHED",
  };
  schedule: Schedule = createSchedule();
  created: NormalizedCreateScheduleInput | null = null;
  updateExpected: UtcTimestamp | null = null;
  transitionOptions: ScheduleTransitionOptions | undefined;

  async findSchedule(): Promise<Schedule | null> {
    return this.schedule;
  }

  async findExamRevision(): Promise<ScheduleExamReference | null> {
    return this.examRevision;
  }

  async createSchedule(
    input: NormalizedCreateScheduleInput,
  ): Promise<Schedule> {
    this.created = input;
    return this.schedule;
  }

  async updateSchedule(
    _id: Id,
    input: NormalizedUpdateScheduleInput,
    expectedUpdatedAt: UtcTimestamp,
  ): Promise<Schedule | null> {
    this.updateExpected = expectedUpdatedAt;
    if (expectedUpdatedAt !== VERSION) throw new ScheduleVersionConflictError();
    this.schedule = {
      ...this.schedule,
      ...(input.endsAt === undefined ? {} : { endsAt: input.endsAt }),
      updatedAt: NEXT_VERSION,
    };
    return this.schedule;
  }

  async deleteSchedule(
    _id: Id,
    expectedUpdatedAt: UtcTimestamp,
  ): Promise<boolean> {
    if (expectedUpdatedAt !== this.schedule.updatedAt)
      throw new ScheduleVersionConflictError();
    return true;
  }

  async transitionSchedule(
    _id: Id,
    targetStatus: "READY" | "OPEN" | "CLOSED" | "ARCHIVED",
    expectedUpdatedAt: UtcTimestamp,
    options?: ScheduleTransitionOptions,
  ): Promise<Schedule | null> {
    if (
      expectedUpdatedAt !== this.schedule.updatedAt &&
      expectedUpdatedAt !== VERSION
    )
      throw new ScheduleVersionConflictError();
    this.transitionOptions = options;
    this.schedule = {
      ...this.schedule,
      status: targetStatus,
      updatedAt: NEXT_VERSION,
      ...(targetStatus === "CLOSED"
        ? {
            closedAt: NOW,
            closedByUserId: options?.closedByUserId ?? null,
            closeReason: options?.closeReason ?? null,
          }
        : {}),
    };
    return this.schedule;
  }
}

function createSchedule(): Schedule {
  const exam = {
    id: REVISION,
    examId: "31" as Id,
    subjectId: SUBJECT,
    ownerTeacherId: TEACHER,
    revisionStatus: "PUBLISHED" as const,
    examStatus: "PUBLISHED" as const,
  };
  return {
    id: SCHEDULE,
    examRevisionId: REVISION,
    exam,
    mode: "MAIN",
    status: "DRAFT",
    startsAt: STARTS,
    endsAt: ENDS,
    durationSeconds: 3_600,
    maxAttempts: 1,
    hardEnd: true,
    allowLateStart: true,
    resultReleasePolicy: "MANUAL",
    hasPracticeToken: false,
    practiceTokenHint: null,
    hasMainAccessCode: true,
    mainAccessCodeHint: "ABCD",
    identityFields: null,
    targetClassIds: [CLASS],
    targetParticipantIds: [],
    closedAt: null,
    closedByUserId: null,
    closeReason: null,
    createdAt: "2026-09-16T00:00:00.000Z" as UtcTimestamp,
    updatedAt: VERSION,
  };
}
