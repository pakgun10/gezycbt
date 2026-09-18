import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import {
  type ActorContext,
  assertActorContext,
  assertMutationContext,
  type UseCaseContext,
} from "../../application/actor-context";
import {
  AuthorizationDeniedError,
  AuthorizationRequiredError,
} from "../../application/authorization";
import type { RuntimeAuditSink } from "./audit";
import {
  type BatchAnswerResult,
  ExamSessionError,
  type FinalAnswerItem,
  type ParticipantResultView,
  type ParticipantSessionView,
  type RuntimeSession,
  type SessionAnswerItem,
  type SessionStartResult,
  type SubmitResult,
  validateStartIdempotencyKey,
} from "./domain";
import {
  createPracticeCredential,
  digestPracticeCredential,
  type PracticeCredential,
} from "./practice-credential";
import type {
  AttemptGrant,
  EndSessionInput,
  ResetAttemptInput,
  RuntimeSessionAccess,
  RuntimeStore,
  ScheduleCloseInput,
  StartMainInput,
  StartPracticeInput,
  TimeExtensionInput,
} from "./repository";

export interface MainSessionStartCommand {
  readonly scheduleId: Id;
  readonly participantName: string;
  readonly classSnapshot?: string | null;
  readonly institutionSnapshot?: string | null;
  readonly identityExtra?: Readonly<Record<string, string>>;
  readonly mainAccessCodeDigest?: Uint8Array;
  readonly startIdempotencyKey: string;
  readonly now?: UtcTimestamp;
}

export interface PracticeResolveResult {
  readonly scheduleId: Id;
  readonly title: string;
  readonly identityFields: unknown;
  readonly startsAt: UtcTimestamp;
  readonly endsAt: UtcTimestamp;
  readonly durationSeconds: number;
}

export interface PracticeSessionStartCommand {
  readonly scheduleId: Id;
  readonly practiceTokenDigest: Uint8Array;
  readonly participantName: string;
  readonly classSnapshot?: string | null;
  readonly institutionSnapshot?: string | null;
  readonly identityExtra?: Readonly<Record<string, string>>;
  readonly startIdempotencyKey: string;
  readonly now?: UtcTimestamp;
}

export class ExamSessionStartService {
  constructor(
    private readonly store: RuntimeStore,
    private readonly audit?: RuntimeAuditSink,
  ) {}

  async startMain(
    context: UseCaseContext,
    input: MainSessionStartCommand,
  ): Promise<SessionStartResult> {
    assertParticipantContext(context.actor);
    assertMutationContext(context);
    const startIdempotencyKey = validateStartIdempotencyKey(
      input.startIdempotencyKey,
    );
    const result = await this.store.startMain({
      ...input,
      participant: {
        participantId: context.actor.userId,
        participantClassIds: [],
      },
      startIdempotencyKey,
    });
    await this.audit?.record({
      action: "SESSION_START",
      actorUserId: context.actor.userId,
      sessionId: result.session.id,
      scheduleId: result.session.scheduleId,
      occurredAt: result.serverNow,
      metadata: {
        replayed: result.replayed,
        attemptNo: result.session.attemptNo,
      },
    });
    return result;
  }

  async startMainWithEligibility(
    context: UseCaseContext,
    input: MainSessionStartCommand,
    participantClassIds: readonly Id[],
  ): Promise<SessionStartResult> {
    assertParticipantContext(context.actor);
    assertMutationContext(context);
    const startIdempotencyKey = validateStartIdempotencyKey(
      input.startIdempotencyKey,
    );
    const result = await this.store.startMain({
      ...input,
      participant: { participantId: context.actor.userId, participantClassIds },
      startIdempotencyKey,
    });
    await this.audit?.record({
      action: "SESSION_START",
      actorUserId: context.actor.userId,
      sessionId: result.session.id,
      scheduleId: result.session.scheduleId,
      occurredAt: result.serverNow,
      metadata: {
        replayed: result.replayed,
        attemptNo: result.session.attemptNo,
      },
    });
    return result;
  }

  async resolvePractice(input: {
    readonly scheduleId?: Id;
    readonly practiceTokenDigest: Uint8Array;
    readonly now?: UtcTimestamp;
  }): Promise<PracticeResolveResult> {
    const schedule =
      input.scheduleId === undefined
        ? await this.store.resolvePracticeByToken(
            input.practiceTokenDigest,
            input.now,
          )
        : await this.store.resolvePractice(
            input.scheduleId,
            input.practiceTokenDigest,
            input.now,
          );
    if (!schedule)
      throw new ExamSessionError(
        "PRACTICE_ACCESS_INVALID",
        "Token atau jadwal latihan tidak valid.",
        401,
      );
    return {
      scheduleId: schedule.id,
      title: schedule.examTitle,
      identityFields: schedule.identityFields ?? null,
      startsAt: schedule.startsAt,
      endsAt: schedule.endsAt,
      durationSeconds: schedule.durationSeconds,
    };
  }

  async startPractice(
    input: PracticeSessionStartCommand,
  ): Promise<SessionStartResult> {
    const startIdempotencyKey = validateStartIdempotencyKey(
      input.startIdempotencyKey,
    );
    return this.store.startPractice({ ...input, startIdempotencyKey });
  }

  /** Starts a guest session and returns a separate opaque resume cookie. */
  async startPracticeWithCredential(
    input: PracticeSessionStartCommand,
  ): Promise<
    SessionStartResult & { readonly practiceCredential?: PracticeCredential }
  > {
    const startIdempotencyKey = validateStartIdempotencyKey(
      input.startIdempotencyKey,
    );
    const token = Buffer.from(
      crypto.getRandomValues(new Uint8Array(32)),
    ).toString("base64url");
    const result = await this.store.startPractice({
      ...input,
      startIdempotencyKey,
      practiceCredentialDigest: await digestPracticeCredential(token),
    });
    // The raw credential is intentionally available only on the first
    // response. A replay must keep the browser's existing cookie; issuing a
    // newly generated cookie would not match the digest persisted for the
    // original session and would make the replayed session unrecoverable.
    if (result.replayed) return result;
    const credential = await createPracticeCredential(result.session.id, token);
    return { ...result, practiceCredential: credential };
  }
}

export class ExamAnswerService {
  constructor(
    private readonly store: RuntimeStore,
    private readonly audit?: RuntimeAuditSink,
  ) {}

  async save(
    context: UseCaseContext,
    sessionId: Id,
    items: readonly SessionAnswerItem[],
    now?: UtcTimestamp,
    practiceCredential?: Uint8Array,
  ): Promise<BatchAnswerResult> {
    const access = assertRuntimeParticipantContext(context, practiceCredential);
    assertMutationContext(context);
    const result = await this.store.saveAnswers(sessionId, items, now, access);
    await this.audit?.record({
      action: "ANSWER_SAVE",
      sessionId,
      occurredAt: result.serverNow,
      metadata: {
        itemCount: items.length,
        savedCount: result.outcomes.filter((item) => item.status === "SAVED")
          .length,
        conflictCount: result.outcomes.filter(
          (item) => item.status === "CONFLICT",
        ).length,
      },
    });
    return result;
  }
}

export class ExamSessionQueryService {
  constructor(private readonly store: RuntimeStore) {}

  async getParticipantSession(
    context: UseCaseContext,
    sessionId: Id,
    practiceCredential?: Uint8Array,
    now?: UtcTimestamp,
  ): Promise<ParticipantSessionView> {
    assertActorContext(context.actor);
    if (context.actor.role !== "PARTICIPANT" && !practiceCredential)
      throw new AuthorizationDeniedError("EXAM_SESSION_OWNER");
    return this.store.getParticipantSession(
      sessionId,
      context.actor.role === "PARTICIPANT" ? context.actor.userId : undefined,
      practiceCredential,
      now,
    );
  }

  async getParticipantResult(
    context: UseCaseContext,
    sessionId: Id,
    practiceCredential?: Uint8Array,
    now?: UtcTimestamp,
  ): Promise<ParticipantResultView> {
    const session = await this.getParticipantSession(
      context,
      sessionId,
      practiceCredential,
      now,
    );
    const result = await this.store.getResult(sessionId);
    if (!result)
      throw new ExamSessionError(
        "SERVICE_BUSY",
        "Hasil ujian belum tersedia.",
        503,
      );
    if (session.session.participantId !== null && result.releasedAt === null)
      throw new ExamSessionError(
        "RESULT_NOT_RELEASED",
        "Hasil ujian belum dirilis.",
        409,
      );
    const practice = session.session.participantId === null;
    const canRetryReason = practice
      ? session.session.finalizationReason === "SCHEDULE_CLOSE"
        ? ("SCHEDULE_CLOSED" as const)
        : null
      : ("ATTEMPT_LIMIT_REACHED" as const);
    return {
      result,
      canRetry: practice && canRetryReason === null,
      canRetryReason,
    };
  }
}

export class ExamSubmissionService {
  constructor(
    private readonly store: RuntimeStore,
    private readonly audit?: RuntimeAuditSink,
  ) {}

  async submit(
    context: UseCaseContext,
    sessionId: Id,
    finalAnswers: readonly FinalAnswerItem[],
    now?: UtcTimestamp,
    practiceCredential?: Uint8Array,
  ): Promise<SubmitResult> {
    const access = assertRuntimeParticipantContext(context, practiceCredential);
    assertMutationContext(context);
    const idempotencyKey = context.idempotencyKey;
    if (!idempotencyKey) throw new AuthorizationRequiredError();
    const result = await this.store.submit(
      sessionId,
      finalAnswers,
      idempotencyKey,
      now,
      access,
    );
    await this.audit?.record({
      action: "SESSION_SUBMIT",
      sessionId,
      occurredAt: result.serverNow,
      metadata: { replayed: result.replayed },
    });
    return result;
  }
}

export class ExamTimeoutFinalizer {
  constructor(
    private readonly store: RuntimeStore,
    private readonly audit?: RuntimeAuditSink,
  ) {}

  runOnce(now?: UtcTimestamp, limit = 50): Promise<readonly Id[]> {
    return this.store.finalizeDue(now, limit).then(async (ids) => {
      const occurredAt = now ?? (new Date().toISOString() as UtcTimestamp);
      for (const sessionId of ids)
        await this.audit?.record({
          action: "SESSION_TIMEOUT",
          sessionId,
          occurredAt,
        });
      return ids;
    });
  }
}

export class ExamSessionAdministrationService {
  constructor(
    private readonly store: RuntimeStore,
    private readonly audit?: RuntimeAuditSink,
  ) {}

  async extendTime(
    context: UseCaseContext,
    input: Omit<TimeExtensionInput, "actorUserId">,
  ): Promise<RuntimeSession> {
    assertStaffContext(context.actor);
    assertMutationContext(context);
    const result = await this.store.extendTime({
      ...input,
      actorUserId: context.actor.userId,
    });
    await this.audit?.record({
      action: "TIME_EXTENSION",
      actorUserId: context.actor.userId,
      sessionId: result.id,
      reason: input.reason,
      occurredAt: result.updatedAt ?? result.lastSeenAt,
      metadata: { additionalMinutes: input.additionalMinutes },
    });
    return result;
  }

  async endSession(
    context: UseCaseContext,
    input: Omit<EndSessionInput, "actorUserId">,
  ): Promise<SubmitResult> {
    assertStaffContext(context.actor);
    assertMutationContext(context);
    const result = await this.store.endSession({
      ...input,
      actorUserId: context.actor.userId,
    });
    await this.audit?.record({
      action: "SESSION_END",
      actorUserId: context.actor.userId,
      sessionId: result.session.id,
      reason: input.reason,
      occurredAt: result.serverNow,
    });
    return result;
  }

  async closeSchedule(
    context: UseCaseContext,
    input: Omit<ScheduleCloseInput, "actorUserId">,
  ): Promise<Awaited<ReturnType<RuntimeStore["closeSchedule"]>>> {
    assertStaffContext(context.actor);
    assertMutationContext(context);
    const result = await this.store.closeSchedule({
      ...input,
      actorUserId: context.actor.userId,
    });
    await this.audit?.record({
      action: "SCHEDULE_CLOSE",
      actorUserId: context.actor.userId,
      scheduleId: result.id,
      ...(input.reason ? { reason: input.reason } : {}),
      occurredAt:
        result.updatedAt ??
        input.now ??
        (new Date().toISOString() as UtcTimestamp),
    });
    return result;
  }

  async resetAttempt(
    context: UseCaseContext,
    input: Omit<ResetAttemptInput, "actorUserId">,
  ): Promise<AttemptGrant> {
    assertStaffContext(context.actor);
    assertMutationContext(context);
    const result = await this.store.resetAttempt({
      ...input,
      actorUserId: context.actor.userId,
    });
    await this.audit?.record({
      action: "ATTEMPT_RESET",
      actorUserId: context.actor.userId,
      sessionId: result.sourceSessionId,
      scheduleId: result.scheduleId,
      reason: input.reason,
      occurredAt: result.createdAt,
      metadata: { grantedAttemptNo: result.grantedAttemptNo },
    });
    return result;
  }
}

function assertParticipantContext(
  actor: ActorContext,
): asserts actor is ActorContext & {
  readonly userId: Id;
  readonly role: "PARTICIPANT";
} {
  assertActorContext(actor);
  if (
    actor.actorType !== "HUMAN" ||
    actor.role !== "PARTICIPANT" ||
    !actor.userId ||
    actor.active === false
  )
    throw new AuthorizationRequiredError();
}

function assertStaffContext(
  actor: ActorContext,
): asserts actor is ActorContext & {
  readonly userId: Id;
  readonly role: "ADMIN" | "TEACHER";
} {
  assertActorContext(actor);
  if (
    (actor.actorType !== "HUMAN" && actor.actorType !== "EXTERNAL_AGENT") ||
    (actor.role !== "ADMIN" && actor.role !== "TEACHER") ||
    !actor.userId ||
    actor.active === false
  )
    throw new AuthorizationRequiredError();
}

function assertRuntimeParticipantContext(
  context: UseCaseContext,
  practiceCredential?: Uint8Array,
): RuntimeSessionAccess {
  assertActorContext(context.actor);
  if (
    context.actor.actorType === "HUMAN" &&
    context.actor.role === "PARTICIPANT" &&
    context.actor.userId &&
    context.actor.active !== false
  )
    return { participantId: context.actor.userId };
  if (practiceCredential && practiceCredential.byteLength > 0)
    return { practiceCredential };
  throw new AuthorizationRequiredError();
}

export type {
  EndSessionInput,
  FinalAnswerItem,
  ResetAttemptInput,
  ScheduleCloseInput,
  SessionAnswerItem,
  StartMainInput,
  StartPracticeInput,
  TimeExtensionInput,
};
