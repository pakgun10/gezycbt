import {
  type Id,
  parseUtcTimestamp,
  type UtcTimestamp,
} from "@gezycbt/contracts";
import {
  assertActorContext,
  assertMutationContext,
  type UseCaseContext,
} from "../../application/actor-context";
import type { AuthorizationPolicyService } from "../../application/authorization";
import {
  type CreateScheduleInput,
  durationFitsWindow,
  isWithinScheduleWindow,
  type NormalizedUpdateScheduleInput,
  type Schedule,
  ScheduleExamRevisionNotFoundError,
  ScheduleExamRevisionNotPublishedError,
  ScheduleImmutableError,
  ScheduleNotFoundError,
  ScheduleNotReadyError,
  type ScheduleTransition,
  ScheduleTransitionError,
  ScheduleValidationError,
  ScheduleWindowError,
  type UpdateScheduleInput,
  validateCompleteSchedule,
  validateCreateScheduleInput,
  validateUpdateScheduleInput,
} from "./domain";
import type { ScheduleRepository } from "./repository";

export class ScheduleService {
  constructor(
    private readonly repository: ScheduleRepository,
    private readonly authorization: Pick<
      AuthorizationPolicyService,
      "assertTeacherScope" | "assertAdmin"
    >,
  ) {}

  async createSchedule(
    context: UseCaseContext,
    input: CreateScheduleInput,
  ): Promise<Schedule> {
    assertMutationContext(context);
    const normalized = validateCreateScheduleInput(input);
    const exam = await this.repository.findExamRevision(
      normalized.examRevisionId,
    );
    if (!exam) throw new ScheduleExamRevisionNotFoundError();
    if (exam.revisionStatus !== "PUBLISHED" || exam.examStatus !== "PUBLISHED")
      throw new ScheduleExamRevisionNotPublishedError();
    await this.authorization.assertTeacherScope(context.actor, {
      ownerTeacherId: exam.ownerTeacherId,
      subjectId: exam.subjectId,
      classIds: normalized.targetClassIds,
    });
    return this.repository.createSchedule(normalized);
  }

  async getSchedule(context: UseCaseContext, id: Id): Promise<Schedule | null> {
    assertActorContext(context.actor);
    const schedule = await this.repository.findSchedule(id);
    if (!schedule) return null;
    await this.assertScope(context, schedule);
    return schedule;
  }

  async updateSchedule(
    context: UseCaseContext,
    id: Id,
    input: UpdateScheduleInput,
    expectedUpdatedAt: UtcTimestamp,
  ): Promise<Schedule> {
    assertMutationContext(context);
    const current = await this.repository.findSchedule(id);
    if (!current) throw new ScheduleNotFoundError();
    await this.assertScope(context, current);
    if (current.status !== "DRAFT") throw new ScheduleImmutableError();
    const expected = requireTimestamp(expectedUpdatedAt, "expectedUpdatedAt");
    const normalized = validateUpdateScheduleInput(input, current.mode);
    const merged = mergeSchedule(current, normalized);
    validateDraftInvariants(merged);
    const updated = await this.repository.updateSchedule(
      id,
      normalized,
      expected,
    );
    if (!updated) throw new ScheduleNotFoundError();
    return updated;
  }

  async deleteSchedule(
    context: UseCaseContext,
    id: Id,
    expectedUpdatedAt: UtcTimestamp,
  ): Promise<void> {
    assertMutationContext(context);
    const current = await this.repository.findSchedule(id);
    if (!current) throw new ScheduleNotFoundError();
    await this.assertScope(context, current);
    const deleted = await this.repository.deleteSchedule(
      id,
      requireTimestamp(expectedUpdatedAt, "expectedUpdatedAt"),
    );
    if (!deleted) throw new ScheduleNotFoundError();
  }

  async transitionSchedule(
    context: UseCaseContext,
    id: Id,
    targetStatus: ScheduleTransition,
    expectedUpdatedAt: UtcTimestamp,
    now: UtcTimestamp,
    closeReason?: string,
  ): Promise<Schedule> {
    assertMutationContext(context);
    const schedule = await this.repository.findSchedule(id);
    if (!schedule) throw new ScheduleNotFoundError();
    await this.assertScope(context, schedule);
    const expected = requireTimestamp(expectedUpdatedAt, "expectedUpdatedAt");
    const serverNow = requireTimestamp(now, "now");
    if (targetStatus === "READY" || targetStatus === "OPEN") {
      const readiness = validateCompleteSchedule(schedule, serverNow);
      if (!readiness.isReady)
        throw new ScheduleNotReadyError(readiness.reasons);
    }
    if (targetStatus === "OPEN" && !isWithinScheduleWindow(schedule, serverNow))
      throw new ScheduleWindowError();
    if (targetStatus === "CLOSED") {
      const reason = closeReason?.trim();
      if (!reason)
        throw new ScheduleValidationError(
          "closeReason is required",
          "CLOSE_REASON_REQUIRED",
        );
      if (reason.length > 500)
        throw new ScheduleValidationError(
          "closeReason must not exceed 500 characters",
          "INVALID_CLOSE_REASON",
        );
      if (context.actor.actorType !== "HUMAN" || !context.actor.userId)
        throw new ScheduleTransitionError(
          "Only a staff member can manually close a schedule",
          "STAFF_CLOSE_REQUIRED",
        );
      const closed = await this.repository.transitionSchedule(
        id,
        targetStatus,
        expected,
        {
          closedByUserId: context.actor.userId,
          closeReason: reason,
        },
      );
      if (!closed) throw new ScheduleNotFoundError();
      return closed;
    }
    if (targetStatus === "ARCHIVED") {
      if (context.actor.actorType !== "HUMAN")
        throw new ScheduleTransitionError(
          "Only an administrator can archive a schedule",
          "ADMIN_ARCHIVE_REQUIRED",
        );
      this.authorization.assertAdmin(context.actor);
    }
    const transitioned = await this.repository.transitionSchedule(
      id,
      targetStatus,
      expected,
    );
    if (!transitioned) throw new ScheduleNotFoundError();
    return transitioned;
  }

  async advanceLifecycle(
    context: UseCaseContext,
    id: Id,
    now: UtcTimestamp,
  ): Promise<Schedule | null> {
    assertActorContext(context.actor);
    const serverNow = requireTimestamp(now, "now");
    let schedule = await this.repository.findSchedule(id);
    if (!schedule) return null;
    await this.assertScope(context, schedule);
    if (
      schedule.status === "READY" &&
      Date.parse(serverNow) >= Date.parse(schedule.endsAt)
    ) {
      schedule = await this.repository.transitionSchedule(
        id,
        "CLOSED",
        schedule.updatedAt,
        { closedByUserId: null, closeReason: null },
      );
    } else if (
      schedule.status === "READY" &&
      isWithinScheduleWindow(schedule, serverNow)
    ) {
      const readiness = validateCompleteSchedule(schedule, serverNow);
      if (!readiness.isReady)
        throw new ScheduleNotReadyError(readiness.reasons);
      schedule = await this.repository.transitionSchedule(
        id,
        "OPEN",
        schedule.updatedAt,
      );
    } else if (
      schedule.status === "OPEN" &&
      Date.parse(serverNow) >= Date.parse(schedule.endsAt)
    ) {
      schedule = await this.repository.transitionSchedule(
        id,
        "CLOSED",
        schedule.updatedAt,
        { closedByUserId: null, closeReason: null },
      );
    }
    return schedule;
  }

  async closeSchedule(
    context: UseCaseContext,
    id: Id,
    expectedUpdatedAt: UtcTimestamp,
    closeReason: string,
    now: UtcTimestamp,
  ): Promise<Schedule> {
    return this.transitionSchedule(
      context,
      id,
      "CLOSED",
      expectedUpdatedAt,
      now,
      closeReason,
    );
  }

  async archiveSchedule(
    context: UseCaseContext,
    id: Id,
    expectedUpdatedAt: UtcTimestamp,
  ): Promise<Schedule> {
    assertMutationContext(context);
    const schedule = await this.repository.findSchedule(id);
    if (!schedule) throw new ScheduleNotFoundError();
    await this.assertScope(context, schedule);
    this.authorization.assertAdmin(context.actor);
    const archived = await this.repository.transitionSchedule(
      id,
      "ARCHIVED",
      requireTimestamp(expectedUpdatedAt, "expectedUpdatedAt"),
    );
    if (!archived) throw new ScheduleNotFoundError();
    return archived;
  }

  private async assertScope(
    context: UseCaseContext,
    schedule: Schedule,
  ): Promise<void> {
    if (context.actor.actorType === "SYSTEM") return;
    await this.authorization.assertTeacherScope(context.actor, {
      ownerTeacherId: schedule.exam.ownerTeacherId,
      subjectId: schedule.exam.subjectId,
      classIds: schedule.targetClassIds,
    });
  }
}

function mergeSchedule(
  current: Schedule,
  input: NormalizedUpdateScheduleInput,
): Schedule {
  let identityFields = current.identityFields;
  if (input.identityFieldsJson !== undefined) {
    identityFields = input.identityFieldsJson
      ? (JSON.parse(input.identityFieldsJson) as Schedule["identityFields"])
      : null;
  }
  return {
    ...current,
    startsAt: input.startsAt ?? current.startsAt,
    endsAt: input.endsAt ?? current.endsAt,
    durationSeconds: input.durationSeconds ?? current.durationSeconds,
    maxAttempts: input.maxAttempts ?? current.maxAttempts,
    hardEnd: true,
    allowLateStart: input.allowLateStart ?? current.allowLateStart,
    resultReleasePolicy:
      input.resultReleasePolicy ?? current.resultReleasePolicy,
    identityFields,
    targetClassIds: input.targetClassIds ?? current.targetClassIds,
    targetParticipantIds:
      input.targetParticipantIds ?? current.targetParticipantIds,
  };
}

function validateDraftInvariants(schedule: Schedule): void {
  if (Date.parse(schedule.startsAt) >= Date.parse(schedule.endsAt))
    throw new ScheduleValidationError(
      "startsAt must be before endsAt",
      "INVALID_WINDOW",
    );
  if (
    !durationFitsWindow(
      schedule.startsAt,
      schedule.endsAt,
      schedule.durationSeconds,
    )
  )
    throw new ScheduleValidationError(
      "durationSeconds must not exceed the schedule window",
      "DURATION_EXCEEDS_WINDOW",
    );
  if (schedule.hardEnd !== true)
    throw new ScheduleValidationError(
      "hardEnd must be true",
      "HARD_END_REQUIRED",
    );
  if (schedule.mode === "MAIN") {
    if (schedule.maxAttempts !== 1)
      throw new ScheduleValidationError(
        "MAIN schedule must allow exactly one attempt",
        "MAIN_ATTEMPT_MUST_BE_ONE",
      );
    if (schedule.resultReleasePolicy !== "MANUAL")
      throw new ScheduleValidationError(
        "MAIN schedule must use MANUAL result release",
        "INVALID_RELEASE_POLICY",
      );
    if (schedule.identityFields !== null || schedule.hasPracticeToken)
      throw new ScheduleValidationError(
        "MAIN schedule cannot contain practice access fields",
        "MAIN_PRACTICE_FIELDS_FORBIDDEN",
      );
  } else {
    if (schedule.maxAttempts < 1)
      throw new ScheduleValidationError(
        "PRACTICE schedule must allow an attempt",
        "INVALID_ATTEMPTS",
      );
    if (schedule.resultReleasePolicy !== "IMMEDIATE_SCORE")
      throw new ScheduleValidationError(
        "PRACTICE schedule must use IMMEDIATE_SCORE",
        "INVALID_RELEASE_POLICY",
      );
    if (schedule.targetClassIds.length || schedule.targetParticipantIds.length)
      throw new ScheduleValidationError(
        "PRACTICE schedule cannot have targets",
        "PRACTICE_TARGETS_FORBIDDEN",
      );
  }
}

function requireTimestamp(value: UtcTimestamp, field: string): UtcTimestamp {
  const parsed = parseUtcTimestamp(value);
  if (!parsed)
    throw new ScheduleValidationError(
      `${field} must be a UTC timestamp`,
      "INVALID_TIMESTAMP",
    );
  return parsed;
}
