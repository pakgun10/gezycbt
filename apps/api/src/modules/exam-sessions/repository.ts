import {
  formatId,
  formatUtcTimestamp,
  type Id,
  type UtcTimestamp,
} from "@gezycbt/contracts";
import type { ScheduleIdentityField } from "../schedules/domain";
import { normalizeIdentitySnapshot } from "../schedules/identity";
import { type ScoringQuestionSnapshot, ScoringService } from "../scoring";
import {
  calculateDeadline,
  createRandomSeed,
  deterministicShuffle,
  type ExamResult,
  ExamSessionError,
  type ExamSessionStatus,
  type FinalAnswerItem,
  type FinalizationReason,
  normalizeAnswerResponse,
  type ParticipantEligibility,
  type ParticipantSessionView,
  participantManifest,
  type RuntimeAnswer,
  type RuntimeQuestionManifest,
  type RuntimeQuestionSource,
  type RuntimeSchedule,
  type RuntimeSession,
  type SessionAnswerItem,
  SessionIdempotencyConflictError,
  SessionNotFoundError,
  type SessionStartResult,
} from "./domain";

export interface RuntimeQuestionDefinition {
  readonly questionRevisionId: Id;
  readonly points: string;
}

export interface RuntimeScheduleRecord extends RuntimeSchedule {
  readonly questionDefinitions: readonly RuntimeQuestionDefinition[];
}

export interface StartMainInput {
  readonly scheduleId: Id;
  readonly participant: ParticipantEligibility;
  readonly participantName: string;
  readonly classSnapshot?: string | null;
  readonly institutionSnapshot?: string | null;
  readonly identityExtra?: Readonly<Record<string, string>>;
  readonly mainAccessCodeDigest?: Uint8Array;
  readonly startIdempotencyKey: string;
  readonly now?: UtcTimestamp;
  readonly practiceTokenDigest?: Uint8Array;
}

export interface StartPracticeInput {
  readonly scheduleId: Id;
  readonly practiceTokenDigest: Uint8Array;
  readonly participantName: string;
  readonly classSnapshot?: string | null;
  readonly institutionSnapshot?: string | null;
  readonly identityExtra?: Readonly<Record<string, string>>;
  readonly startIdempotencyKey: string;
  readonly now?: UtcTimestamp;
  readonly practiceCredentialDigest?: Uint8Array;
}

export interface ResetAttemptInput {
  readonly scheduleId: Id;
  readonly participantId: Id;
  readonly reason: string;
  readonly actorUserId: Id;
  readonly resetIdempotencyKey: string;
  readonly now?: UtcTimestamp;
}

export interface AttemptGrant {
  readonly id: Id;
  readonly scheduleId: Id;
  readonly participantId: Id;
  readonly sourceSessionId: Id;
  readonly grantedAttemptNo: number;
  readonly reason: string;
  readonly grantedByUserId: Id;
  readonly resetIdempotencyKey: string;
  readonly consumedBySessionId: Id | null;
  readonly createdAt: UtcTimestamp;
  readonly consumedAt: UtcTimestamp | null;
}

export interface ScheduleCloseInput {
  readonly scheduleId: Id;
  readonly expectedUpdatedAt?: UtcTimestamp;
  readonly actorUserId?: Id | null;
  readonly reason?: string;
  readonly now?: UtcTimestamp;
}

export interface TimeExtensionInput {
  readonly sessionId: Id;
  readonly additionalMinutes: number;
  readonly reason: string;
  readonly expectedVersion: number;
  readonly actorUserId: Id;
  readonly now?: UtcTimestamp;
}

export interface EndSessionInput {
  readonly sessionId: Id;
  readonly actorUserId: Id;
  readonly reason: string;
  readonly expectedVersion?: number;
  readonly now?: UtcTimestamp;
}

/** Access proof supplied by the participant-facing transport. */
export interface RuntimeSessionAccess {
  readonly participantId?: Id;
  readonly practiceCredential?: Uint8Array;
}

export interface RuntimeStore {
  startMain(input: StartMainInput): Promise<SessionStartResult>;
  startPractice(input: StartPracticeInput): Promise<SessionStartResult>;
  resolvePractice(
    scheduleId: Id,
    tokenDigest: Uint8Array,
    now?: UtcTimestamp,
  ): Promise<RuntimeScheduleRecord | null>;
  getParticipantSession(
    sessionId: Id,
    participantId?: Id,
    practiceCredential?: Uint8Array,
    now?: UtcTimestamp,
  ): Promise<ParticipantSessionView>;
  saveAnswers(
    sessionId: Id,
    items: readonly SessionAnswerItem[],
    now?: UtcTimestamp,
    access?: RuntimeSessionAccess,
  ): Promise<import("./domain").BatchAnswerResult>;
  submit(
    sessionId: Id,
    finalAnswers: readonly FinalAnswerItem[],
    idempotencyKey: string,
    now?: UtcTimestamp,
    access?: RuntimeSessionAccess,
  ): Promise<import("./domain").SubmitResult>;
  finalizeDue(now?: UtcTimestamp, limit?: number): Promise<readonly Id[]>;
  extendTime(input: TimeExtensionInput): Promise<RuntimeSession>;
  endSession(input: EndSessionInput): Promise<import("./domain").SubmitResult>;
  closeSchedule(input: ScheduleCloseInput): Promise<RuntimeScheduleRecord>;
  resetAttempt(input: ResetAttemptInput): Promise<AttemptGrant>;
  getResult(sessionId: Id): Promise<ExamResult | null>;
}

/**
 * Deterministic in-memory runtime used by unit tests and as a reference
 * implementation for the SQL adapter. All mutating operations are serialized
 * through a tiny promise mutex, modelling the row locks used in MariaDB.
 */
export class InMemoryExamRuntimeStore implements RuntimeStore {
  private readonly schedules = new Map<Id, RuntimeScheduleRecord>();
  private readonly sources = new Map<Id, RuntimeQuestionSource>();
  private readonly sessions = new Map<Id, RuntimeSession>();
  private readonly manifests = new Map<Id, RuntimeQuestionManifest[]>();
  private readonly answers = new Map<Id, Map<Id, RuntimeAnswer>>();
  private readonly results = new Map<Id, ExamResult>();
  private readonly grants = new Map<Id, AttemptGrant>();
  private readonly startKeys = new Map<string, Id>();
  private readonly submitKeys = new Map<
    string,
    import("./domain").SubmitResult
  >();
  private idSequence = 1000n;
  private lockTail: Promise<void> = Promise.resolve();
  private readonly scoring = new ScoringService();

  constructor(
    options: {
      readonly schedules?: readonly RuntimeScheduleRecord[];
      readonly questions?: readonly RuntimeQuestionSource[];
    } = {},
  ) {
    for (const schedule of options.schedules ?? []) this.addSchedule(schedule);
    for (const question of options.questions ?? [])
      this.sources.set(question.questionRevisionId, question);
  }

  addSchedule(schedule: RuntimeScheduleRecord): void {
    this.schedules.set(schedule.id, schedule);
  }

  addQuestionSource(source: RuntimeQuestionSource): void {
    this.sources.set(source.questionRevisionId, source);
  }

  getSessionUnsafe(sessionId: Id): RuntimeSession | null {
    return this.sessions.get(sessionId) ?? null;
  }

  getManifestUnsafe(sessionId: Id): readonly RuntimeQuestionManifest[] {
    return this.manifests.get(sessionId) ?? [];
  }

  async startMain(input: StartMainInput): Promise<SessionStartResult> {
    return this.withLock(async () => {
      const schedule = this.requireSchedule(input.scheduleId);
      const now = this.timestamp(input.now);
      if (
        typeof input.participantName !== "string" ||
        !input.participantName.trim() ||
        input.participantName.trim().length > 200
      )
        throw new ExamSessionError(
          "INVALID_ANSWER_SHAPE",
          "Nama peserta tidak valid.",
          422,
        );
      const existingId = this.startKeys.get(
        `${schedule.id}:${input.startIdempotencyKey}`,
      );
      if (existingId) {
        const existing = this.sessions.get(existingId);
        if (
          !existing ||
          existing.participantId !== input.participant.participantId ||
          existing.participantNameSnapshot !== input.participantName.trim() ||
          existing.classSnapshot !== (input.classSnapshot?.trim() || null) ||
          existing.institutionSnapshot !==
            (input.institutionSnapshot?.trim() || null) ||
          stableRecord(existing.identityExtra) !==
            stableRecord(input.identityExtra ?? {})
        )
          throw new SessionIdempotencyConflictError();
        return this.startResult(existing, true, now);
      }
      this.assertMainOpen(schedule, now);
      if (
        !input.mainAccessCodeDigest ||
        !bytesEqual(input.mainAccessCodeDigest, schedule.mainAccessCodeHash)
      )
        throw new ExamSessionError(
          "SCHEDULE_NOT_AVAILABLE",
          "Ujian utama tidak tersedia.",
          409,
        );
      if (
        !schedule.targetParticipantIds.includes(
          input.participant.participantId,
        ) &&
        !schedule.targetClassIds.some((id) =>
          input.participant.participantClassIds.includes(id),
        )
      )
        throw new ExamSessionError(
          "SCHEDULE_NOT_AVAILABLE",
          "Ujian utama tidak tersedia.",
          409,
        );
      const previous = [...this.sessions.values()].filter(
        (session) =>
          session.scheduleId === schedule.id &&
          session.participantId === input.participant.participantId,
      );
      const active = previous.find((session) => session.status === "ACTIVE");
      if (active)
        throw new ExamSessionError(
          "SESSION_ALREADY_ACTIVE",
          "Peserta masih memiliki sesi ujian aktif.",
          409,
          { sessionId: active.id },
        );
      const grant = [...this.grants.values()].find(
        (item) =>
          item.scheduleId === schedule.id &&
          item.participantId === input.participant.participantId &&
          item.consumedBySessionId === null,
      );
      const attemptNo = grant?.grantedAttemptNo ?? previous.length + 1;
      if (!grant && attemptNo > schedule.maxAttempts)
        throw new ExamSessionError(
          "ATTEMPT_LIMIT_REACHED",
          "Batas percobaan ujian sudah tercapai.",
          409,
        );
      const session = this.createSession(schedule, {
        participantId: input.participant.participantId,
        participantName: input.participantName,
        ...(input.classSnapshot === undefined
          ? {}
          : { classSnapshot: input.classSnapshot }),
        ...(input.institutionSnapshot === undefined
          ? {}
          : { institutionSnapshot: input.institutionSnapshot }),
        ...(input.identityExtra === undefined
          ? {}
          : { identityExtra: input.identityExtra }),
        attemptNo,
        startIdempotencyKey: input.startIdempotencyKey,
        now,
      });
      this.startKeys.set(
        `${schedule.id}:${input.startIdempotencyKey}`,
        session.id,
      );
      if (grant) this.consumeGrant(grant, session.id, now);
      return this.startResult(session, false, now);
    });
  }

  async resolvePractice(
    scheduleId: Id,
    tokenDigest: Uint8Array,
    now?: UtcTimestamp,
  ): Promise<RuntimeScheduleRecord | null> {
    const schedule = this.schedules.get(scheduleId);
    const timestamp = this.timestamp(now);
    if (
      !schedule ||
      schedule.mode !== "PRACTICE" ||
      !bytesEqual(tokenDigest, schedule.practiceTokenHash) ||
      !this.isWithinWindow(schedule, timestamp)
    )
      return null;
    return schedule;
  }

  async startPractice(input: StartPracticeInput): Promise<SessionStartResult> {
    return this.withLock(async () => {
      const schedule = this.schedules.get(input.scheduleId);
      const now = this.timestamp(input.now);
      if (
        !schedule ||
        schedule.mode !== "PRACTICE" ||
        !bytesEqual(input.practiceTokenDigest, schedule.practiceTokenHash) ||
        !this.isWithinWindow(schedule, now)
      )
        throw new ExamSessionError(
          "PRACTICE_ACCESS_INVALID",
          "Token atau jadwal latihan tidak valid.",
          401,
        );
      const existingId = this.startKeys.get(
        `${schedule.id}:${input.startIdempotencyKey}`,
      );
      if (existingId) {
        const existing = this.sessions.get(existingId);
        if (
          !existing ||
          existing.participantId !== null ||
          existing.participantNameSnapshot !== input.participantName.trim() ||
          existing.classSnapshot !== (input.classSnapshot?.trim() || null) ||
          existing.institutionSnapshot !==
            (input.institutionSnapshot?.trim() || null) ||
          stableRecord(existing.identityExtra) !==
            stableRecord(input.identityExtra ?? {})
        )
          throw new SessionIdempotencyConflictError();
        return this.startResult(existing, true, now);
      }
      if (
        !input.participantName.trim() ||
        input.participantName.trim().length > 200
      )
        throw new ExamSessionError(
          "INVALID_ANSWER_SHAPE",
          "Nama peserta tidak valid.",
          422,
        );
      const identity = normalizePracticeIdentity(schedule, input);
      const session = this.createSession(schedule, {
        participantId: null,
        participantName: identity.name,
        ...(identity.classSnapshot === undefined
          ? {}
          : { classSnapshot: identity.classSnapshot }),
        ...(identity.institutionSnapshot === undefined
          ? {}
          : { institutionSnapshot: identity.institutionSnapshot }),
        identityExtra: identity.extra,
        attemptNo: 1,
        startIdempotencyKey: input.startIdempotencyKey,
        practice: true,
        practiceTokenHash: input.practiceTokenDigest,
        practiceCredentialHash:
          input.practiceCredentialDigest ?? input.practiceTokenDigest,
        now,
      });
      this.startKeys.set(
        `${schedule.id}:${input.startIdempotencyKey}`,
        session.id,
      );
      return this.startResult(session, false, now);
    });
  }

  async getParticipantSession(
    sessionId: Id,
    participantId?: Id,
    practiceCredential?: Uint8Array,
    now?: UtcTimestamp,
  ): Promise<ParticipantSessionView> {
    return this.withLock(async () => {
      const session = this.sessions.get(sessionId);
      if (!session) throw new SessionNotFoundError();
      this.requireSchedule(session.scheduleId);
      if (
        session.participantId !== null &&
        session.participantId !== participantId
      )
        throw new ExamSessionError(
          "SCHEDULE_NOT_AVAILABLE",
          "Sesi ujian tidak tersedia.",
          409,
        );
      if (
        session.participantId === null &&
        (!practiceCredential ||
          !bytesEqual(
            practiceCredential,
            session.practiceCredentialHash ?? session.practiceTokenHash,
          ))
      )
        throw new ExamSessionError(
          "AUTHENTICATION_REQUIRED",
          "Credential latihan diperlukan.",
          401,
        );
      const timestamp = this.timestamp(now);
      const fresh = this.touchSession(session, timestamp);
      if (
        fresh.status === "ACTIVE" &&
        Date.parse(timestamp) >= Date.parse(fresh.deadlineAt)
      )
        this.finalizeSession(fresh, "DEADLINE", timestamp);
      const authoritative = this.sessions.get(sessionId) as RuntimeSession;
      return this.safeView(authoritative, timestamp);
    });
  }

  async saveAnswers(
    sessionId: Id,
    items: readonly SessionAnswerItem[],
    now?: UtcTimestamp,
    access?: RuntimeSessionAccess,
  ): Promise<import("./domain").BatchAnswerResult> {
    return this.withLock(async () => {
      if (!Array.isArray(items) || items.length === 0 || items.length > 20)
        throw new ExamSessionError(
          "INVALID_ANSWER_SHAPE",
          "Batch jawaban harus berisi 1 sampai 20 item.",
          422,
        );
      assertAnswerItems(items, false);
      const session = this.requireSession(sessionId);
      const timestamp = this.timestamp(now);
      this.assertSessionAccess(session, access);
      this.ensureWritable(session, timestamp);
      const answerMap =
        this.answers.get(sessionId) ?? new Map<Id, RuntimeAnswer>();
      const manifest = this.manifests.get(sessionId) ?? [];
      const outcomes: Array<
        import("./domain").BatchAnswerResult["outcomes"][number]
      > = [];
      const staged: RuntimeAnswer[] = [];
      for (const item of items) {
        const manifestItem = manifest.find(
          (candidate) => candidate.sessionQuestionId === item.sessionQuestionId,
        );
        if (!manifestItem)
          throw new ExamSessionError(
            "INVALID_ANSWER_SHAPE",
            "Soal sesi tidak ditemukan.",
            422,
          );
        const source = this.requireSource(manifestItem.questionRevisionId);
        const response = normalizeAnswerResponse(
          source,
          item.response,
          manifestItem.optionOrder.length
            ? manifestItem.optionOrder
            : manifestItem.statementOrder,
        );
        const current =
          answerMap.get(item.sessionQuestionId) ??
          staged.find(
            (answer) => answer.sessionQuestionId === item.sessionQuestionId,
          );
        const currentVersion = current?.version ?? 0;
        if (item.baseVersion !== currentVersion) {
          outcomes.push({
            sessionQuestionId: item.sessionQuestionId,
            clientMutationId: item.clientMutationId,
            status: "CONFLICT",
            version: currentVersion,
            response: current?.response ?? emptyResponse(source),
          });
          continue;
        }
        if (
          current &&
          JSON.stringify(current.response) === JSON.stringify(response)
        ) {
          outcomes.push({
            sessionQuestionId: item.sessionQuestionId,
            clientMutationId: item.clientMutationId,
            status: "UNCHANGED",
            version: current.version,
          });
          continue;
        }
        const next: RuntimeAnswer = {
          sessionId,
          sessionQuestionId: item.sessionQuestionId,
          response,
          version: currentVersion + 1,
          answeredAt: timestamp,
        };
        staged.push(next);
        outcomes.push({
          sessionQuestionId: item.sessionQuestionId,
          clientMutationId: item.clientMutationId,
          status: "SAVED",
          version: next.version,
        });
      }
      for (const answer of staged)
        answerMap.set(answer.sessionQuestionId, answer);
      this.answers.set(sessionId, answerMap);
      this.sessions.set(sessionId, {
        ...session,
        lastSeenAt: timestamp,
        version: session.version + 1,
        updatedAt: timestamp,
      } as RuntimeSession & { updatedAt: UtcTimestamp });
      const updated = this.sessions.get(sessionId) as RuntimeSession;
      return {
        sessionId,
        outcomes,
        serverNow: timestamp,
        deadlineAt: updated.deadlineAt,
      };
    });
  }

  async submit(
    sessionId: Id,
    finalAnswers: readonly FinalAnswerItem[],
    idempotencyKey: string,
    now?: UtcTimestamp,
    access?: RuntimeSessionAccess,
  ): Promise<import("./domain").SubmitResult> {
    return this.withLock(async () => {
      if (!Array.isArray(finalAnswers) || finalAnswers.length > 500)
        throw new ExamSessionError(
          "INVALID_ANSWER_SHAPE",
          "Final answers tidak valid.",
          422,
        );
      const session = this.requireSession(sessionId);
      this.assertSessionAccess(session, access);
      assertFinalAnswerItems(finalAnswers);
      const key = `${sessionId}:${idempotencyKey}`;
      const replay = this.submitKeys.get(key);
      if (replay) return { ...replay, replayed: true };
      const timestamp = this.timestamp(now);
      if (
        session.status === "SCORED" ||
        session.status === "SUBMITTED" ||
        session.status === "EXPIRED" ||
        session.status === "ENDED"
      ) {
        const result = this.results.get(sessionId);
        if (result) {
          const response = {
            session,
            result,
            serverNow: timestamp,
            replayed: true,
          };
          this.submitKeys.set(key, response);
          return response;
        }
      }
      if (session.status !== "ACTIVE") throw this.statusError(session.status);
      if (Date.parse(timestamp) >= Date.parse(session.deadlineAt)) {
        const finalized = this.finalizeSession(session, "DEADLINE", timestamp);
        const response = {
          session: finalized.session,
          result: finalized.result,
          serverNow: timestamp,
          replayed: false,
        };
        this.submitKeys.set(key, response);
        return response;
      }
      const manifest = this.manifests.get(sessionId) ?? [];
      const staged: RuntimeAnswer[] = [];
      const seen = new Set<Id>();
      const currentAnswers =
        this.answers.get(sessionId) ?? new Map<Id, RuntimeAnswer>();
      for (const item of finalAnswers) {
        if (seen.has(item.sessionQuestionId))
          throw new ExamSessionError(
            "INVALID_ANSWER_SHAPE",
            "Final answer tidak boleh berulang.",
            422,
          );
        seen.add(item.sessionQuestionId);
        const manifestItem = manifest.find(
          (candidate) => candidate.sessionQuestionId === item.sessionQuestionId,
        );
        if (!manifestItem)
          throw new ExamSessionError(
            "INVALID_ANSWER_SHAPE",
            "Soal sesi tidak ditemukan.",
            422,
          );
        const source = this.requireSource(manifestItem.questionRevisionId);
        const response = normalizeAnswerResponse(
          source,
          item.response,
          manifestItem.optionOrder.length
            ? manifestItem.optionOrder
            : manifestItem.statementOrder,
        );
        const current = currentAnswers.get(item.sessionQuestionId);
        const currentVersion = current?.version ?? 0;
        if (item.baseVersion !== currentVersion)
          throw new ExamSessionError(
            "ANSWER_VERSION_CONFLICT",
            "Jawaban berubah di perangkat lain.",
            409,
            {
              sessionQuestionId: item.sessionQuestionId,
              version: currentVersion,
              response: current?.response ?? emptyResponse(source),
            },
          );
        staged.push({
          sessionId,
          sessionQuestionId: item.sessionQuestionId,
          response,
          version: currentVersion + 1,
          answeredAt: timestamp,
        });
      }
      for (const answer of staged)
        currentAnswers.set(answer.sessionQuestionId, answer);
      this.answers.set(sessionId, currentAnswers);
      const finalized = this.finalizeSession(
        session,
        "PARTICIPANT_SUBMIT",
        timestamp,
      );
      const response = {
        session: finalized.session,
        result: finalized.result,
        serverNow: timestamp,
        replayed: false,
      };
      this.submitKeys.set(key, response);
      return response;
    });
  }

  async finalizeDue(now?: UtcTimestamp, limit = 50): Promise<readonly Id[]> {
    return this.withLock(async () => {
      const timestamp = this.timestamp(now);
      const candidates = [...this.sessions.values()]
        .filter(
          (session) =>
            session.status === "ACTIVE" &&
            Date.parse(session.deadlineAt) <= Date.parse(timestamp),
        )
        .sort((a, b) => Date.parse(a.deadlineAt) - Date.parse(b.deadlineAt))
        .slice(0, Math.max(1, Math.min(limit, 100)));
      for (const session of candidates)
        this.finalizeSession(session, "DEADLINE", timestamp);
      return candidates.map((session) => session.id);
    });
  }

  async extendTime(input: TimeExtensionInput): Promise<RuntimeSession> {
    return this.withLock(async () => {
      if (
        !Number.isSafeInteger(input.additionalMinutes) ||
        input.additionalMinutes <= 0 ||
        input.additionalMinutes > 24 * 60
      )
        throw new ExamSessionError(
          "TIME_EXTENSION_INVALID",
          "Perpanjangan waktu harus berupa menit positif.",
          422,
        );
      if (!input.reason.trim() || input.reason.trim().length > 500)
        throw new ExamSessionError(
          "TIME_EXTENSION_INVALID",
          "Alasan perpanjangan wajib diisi (maksimal 500 karakter).",
          422,
        );
      const session = this.requireSession(input.sessionId);
      if (session.status !== "ACTIVE") throw this.statusError(session.status);
      if (session.version !== input.expectedVersion)
        throw new ExamSessionError(
          "ANSWER_VERSION_CONFLICT",
          "Sesi sudah berubah. Muat ulang sebelum mengubah waktu.",
          409,
          { version: session.version },
        );
      const schedule = this.requireSchedule(session.scheduleId);
      const timestamp = this.timestamp(input.now);
      const deadline = calculateDeadline(
        session.deadlineAt,
        input.additionalMinutes * 60,
        schedule.endsAt,
      );
      const updated: RuntimeSession = {
        ...session,
        deadlineAt: deadline,
        version: session.version + 1,
        lastSeenAt: timestamp,
      };
      this.sessions.set(session.id, updated);
      return updated;
    });
  }

  async endSession(
    input: EndSessionInput,
  ): Promise<import("./domain").SubmitResult> {
    return this.withLock(async () => {
      const session = this.requireSession(input.sessionId);
      const timestamp = this.timestamp(input.now);
      if (
        session.status === "SCORED" ||
        session.status === "ENDED" ||
        session.status === "EXPIRED" ||
        session.status === "SUBMITTED"
      ) {
        const result = this.results.get(session.id);
        if (result)
          return { session, result, serverNow: timestamp, replayed: true };
      }
      if (session.status !== "ACTIVE") throw this.statusError(session.status);
      if (
        input.expectedVersion !== undefined &&
        input.expectedVersion !== session.version
      )
        throw new ExamSessionError(
          "ANSWER_VERSION_CONFLICT",
          "Sesi sudah berubah. Muat ulang sebelum mengakhiri.",
          409,
          { version: session.version },
        );
      if (!input.reason.trim() || input.reason.trim().length > 500)
        throw new ExamSessionError(
          "INVALID_ANSWER_SHAPE",
          "Alasan mengakhiri sesi wajib diisi.",
          422,
        );
      const finalized = this.finalizeSession(
        session,
        "STAFF_END",
        timestamp,
        input.actorUserId,
        input.reason.trim(),
      );
      return {
        session: finalized.session,
        result: finalized.result,
        serverNow: timestamp,
        replayed: false,
      };
    });
  }

  async closeSchedule(
    input: ScheduleCloseInput,
  ): Promise<RuntimeScheduleRecord> {
    return this.withLock(async () => {
      const schedule = this.requireSchedule(input.scheduleId);
      const timestamp = this.timestamp(input.now);
      if (schedule.status === "CLOSED" || schedule.status === "ARCHIVED")
        return schedule;
      if (
        input.expectedUpdatedAt &&
        (schedule as RuntimeScheduleRecord & { updatedAt?: string })
          .updatedAt &&
        input.expectedUpdatedAt !==
          (schedule as RuntimeScheduleRecord & { updatedAt?: string }).updatedAt
      )
        throw new ExamSessionError(
          "SCHEDULE_CLOSE_CONFLICT",
          "Jadwal sudah berubah.",
          409,
        );
      if (input.actorUserId && !input.reason?.trim())
        throw new ExamSessionError(
          "INVALID_ANSWER_SHAPE",
          "Alasan menutup jadwal wajib diisi.",
          422,
        );
      const next = {
        ...schedule,
        status: "CLOSED" as const,
        closedAt: timestamp,
        closedByUserId: input.actorUserId ?? null,
        closeReason: input.reason?.trim() ?? null,
        updatedAt: timestamp,
      } as RuntimeScheduleRecord;
      this.schedules.set(schedule.id, next);
      for (const session of [...this.sessions.values()].filter(
        (item) => item.scheduleId === schedule.id && item.status === "ACTIVE",
      ))
        this.finalizeSession(
          session,
          "SCHEDULE_CLOSE",
          timestamp,
          input.actorUserId ?? undefined,
          input.reason?.trim(),
        );
      return next;
    });
  }

  async resetAttempt(input: ResetAttemptInput): Promise<AttemptGrant> {
    return this.withLock(async () => {
      const schedule = this.requireSchedule(input.scheduleId);
      if (schedule.mode !== "MAIN")
        throw new ExamSessionError(
          "RESET_NOT_ALLOWED",
          "Reset attempt hanya tersedia untuk ujian utama.",
          409,
        );
      if (!input.reason.trim() || input.reason.trim().length > 500)
        throw new ExamSessionError(
          "RESET_NOT_ALLOWED",
          "Alasan reset wajib diisi (maksimal 500 karakter).",
          422,
        );
      const existingByKey = [...this.grants.values()].find(
        (grant) =>
          grant.scheduleId === schedule.id &&
          grant.resetIdempotencyKey === input.resetIdempotencyKey,
      );
      if (existingByKey) return existingByKey;
      const pending = [...this.grants.values()].find(
        (grant) =>
          grant.scheduleId === schedule.id &&
          grant.participantId === input.participantId &&
          grant.consumedBySessionId === null,
      );
      if (pending)
        throw new ExamSessionError(
          "RESET_NOT_ALLOWED",
          "Peserta sudah memiliki attempt baru yang tersedia.",
          409,
          { grantId: pending.id },
        );
      const source = [...this.sessions.values()]
        .filter(
          (session) =>
            session.scheduleId === schedule.id &&
            session.participantId === input.participantId,
        )
        .sort((a, b) => b.attemptNo - a.attemptNo)[0];
      if (!source)
        throw new ExamSessionError(
          "RESET_NOT_ALLOWED",
          "Belum ada attempt yang dapat direset.",
          409,
        );
      const timestamp = this.timestamp(input.now);
      if (source.status === "ACTIVE")
        this.finalizeSession(
          source,
          "RESET_ATTEMPT",
          timestamp,
          input.actorUserId,
          input.reason.trim(),
        );
      const grant: AttemptGrant = {
        id: this.nextId(),
        scheduleId: schedule.id,
        participantId: input.participantId,
        sourceSessionId: source.id,
        grantedAttemptNo: source.attemptNo + 1,
        reason: input.reason.trim(),
        grantedByUserId: input.actorUserId,
        resetIdempotencyKey: input.resetIdempotencyKey,
        consumedBySessionId: null,
        createdAt: timestamp,
        consumedAt: null,
      };
      this.grants.set(grant.id, grant);
      return grant;
    });
  }

  async getResult(sessionId: Id): Promise<ExamResult | null> {
    return this.results.get(sessionId) ?? null;
  }

  private createSession(
    schedule: RuntimeScheduleRecord,
    input: {
      participantId: Id | null;
      participantName: string;
      classSnapshot?: string | null;
      institutionSnapshot?: string | null;
      identityExtra?: Readonly<Record<string, string>>;
      attemptNo: number;
      startIdempotencyKey: string;
      practice?: boolean;
      practiceTokenHash?: Uint8Array;
      practiceCredentialHash?: Uint8Array;
      now: UtcTimestamp;
    },
  ): RuntimeSession {
    const seed = createRandomSeed();
    const order = schedule.shuffleQuestions
      ? deterministicShuffle(schedule.questionDefinitions, seed)
      : [...schedule.questionDefinitions];
    const manifest = order.map((definition, index) => {
      const source = this.requireSource(definition.questionRevisionId);
      const optionOrder =
        source.type === "TRUE_FALSE"
          ? []
          : schedule.shuffleOptions
            ? deterministicShuffle(
                source.options.map((option) => option.id),
                seedFor(seed, index),
              )
            : source.options.map((option) => option.id);
      const statementOrder = source.statements.map((statement) => statement.id);
      const sessionQuestionId = this.nextId();
      return participantManifest(source, {
        sessionQuestionId,
        questionId: source.questionId,
        questionRevisionId: source.questionRevisionId,
        displayPosition: index + 1,
        points: definition.points,
        optionOrder,
        statementOrder,
      });
    });
    const session: RuntimeSession = {
      id: this.nextId(),
      scheduleId: schedule.id,
      examRevisionId: schedule.examRevisionId,
      participantId: input.participantId,
      attemptNo: input.attemptNo,
      status: "ACTIVE",
      startedAt: input.now,
      deadlineAt: calculateDeadline(
        input.now,
        schedule.durationSeconds,
        schedule.endsAt,
      ),
      lastSeenAt: input.now,
      submittedAt: null,
      expiredAt: null,
      endedAt: null,
      scoredAt: null,
      finalizationReason: null,
      finalizedByUserId: null,
      finalizationNote: null,
      participantNameSnapshot: input.participantName.trim(),
      classSnapshot: input.classSnapshot?.trim() || null,
      institutionSnapshot: input.institutionSnapshot?.trim() || null,
      identityExtra: input.identityExtra ?? {},
      randomSeed: seed,
      startIdempotencyKey: input.startIdempotencyKey,
      practice: input.practice ?? false,
      ...(input.practiceTokenHash
        ? { practiceTokenHash: new Uint8Array(input.practiceTokenHash) }
        : {}),
      ...(input.practiceCredentialHash
        ? {
            practiceCredentialHash: new Uint8Array(
              input.practiceCredentialHash,
            ),
          }
        : {}),
      version: 1,
      updatedAt: input.now,
    };
    this.sessions.set(session.id, session);
    this.manifests.set(session.id, manifest);
    this.answers.set(session.id, new Map());
    return session;
  }

  private finalizeSession(
    session: RuntimeSession,
    reason: FinalizationReason,
    now: UtcTimestamp,
    actorUserId?: Id,
    note?: string,
  ): { session: RuntimeSession; result: ExamResult } {
    const answers = [...(this.answers.get(session.id)?.values() ?? [])];
    const manifest = this.manifests.get(session.id) ?? [];
    const scoringQuestions: ScoringQuestionSnapshot[] = manifest.map((item) =>
      this.scoringSnapshot(item),
    );
    const answerByQuestion = new Map(
      manifest.map((item) => [
        item.questionId,
        this.answers.get(session.id)?.get(item.sessionQuestionId)?.response,
      ]),
    );
    const score = this.scoring.score({
      questions: scoringQuestions,
      answers: [...answerByQuestion.entries()]
        .filter(
          (entry): entry is [Id, import("../scoring").ScoringResponse] =>
            entry[1] !== undefined,
        )
        .map(([questionId, response]) => ({ questionId, response })),
    });
    const finalStatus: ExamSessionStatus = "SCORED";
    const updated: RuntimeSession = {
      ...session,
      status: finalStatus,
      submittedAt: reason === "PARTICIPANT_SUBMIT" ? now : session.submittedAt,
      expiredAt: reason === "DEADLINE" ? now : session.expiredAt,
      endedAt:
        reason === "SCHEDULE_CLOSE" ||
        reason === "STAFF_END" ||
        reason === "RESET_ATTEMPT"
          ? now
          : session.endedAt,
      scoredAt: now,
      finalizationReason: reason,
      finalizedByUserId: actorUserId ?? null,
      finalizationNote: note ?? null,
      lastSeenAt: now,
      updatedAt: now,
      version: session.version + 1,
    };
    this.sessions.set(session.id, updated);
    const schedule = this.requireSchedule(session.scheduleId);
    const result: ExamResult = {
      sessionId: session.id,
      scheduleId: session.scheduleId,
      participantId: session.participantId,
      correctCount: score.correctCount,
      incorrectCount: score.incorrectCount,
      unansweredCount: score.unansweredCount,
      earnedScore: score.earnedScore,
      maxScore: score.maxScore,
      percentage: score.percentage,
      scoredAt: now,
      releasedAt:
        schedule.resultReleasePolicy === "IMMEDIATE_SCORE" ? now : null,
    };
    this.results.set(session.id, result);
    void answers;
    return { session: updated, result };
  }

  private scoringSnapshot(
    item: RuntimeQuestionManifest,
  ): ScoringQuestionSnapshot {
    const source = this.requireSource(item.questionRevisionId);
    return {
      questionId: item.questionId,
      questionRevisionId: item.questionRevisionId,
      status: "PUBLISHED",
      type: source.type,
      points: item.points,
      options: source.options.map(({ id, isCorrect }) => ({ id, isCorrect })),
      statements: source.statements.map(({ id, correctValue }) => ({
        id,
        correctValue,
      })),
    };
  }

  private startResult(
    session: RuntimeSession,
    replayed: boolean,
    now: UtcTimestamp,
  ): SessionStartResult {
    return {
      session,
      manifest: this.manifests.get(session.id) ?? [],
      serverNow: now,
      replayed,
    };
  }

  private safeView(
    session: RuntimeSession,
    now: UtcTimestamp,
  ): ParticipantSessionView {
    const {
      randomSeed: _seed,
      finalizationNote: _note,
      practiceTokenHash: _token,
      practiceCredentialHash: _credential,
      ...safeSession
    } = session;
    return {
      session: safeSession,
      manifest: this.manifests.get(session.id) ?? [],
      answers: [...(this.answers.get(session.id)?.values() ?? [])],
      serverNow: now,
    };
  }

  private consumeGrant(
    grant: AttemptGrant,
    sessionId: Id,
    now: UtcTimestamp,
  ): void {
    this.grants.set(grant.id, {
      ...grant,
      consumedBySessionId: sessionId,
      consumedAt: now,
    });
  }

  private assertMainOpen(
    schedule: RuntimeScheduleRecord,
    now: UtcTimestamp,
  ): void {
    if (
      schedule.mode !== "MAIN" ||
      !this.isWithinWindow(schedule, now) ||
      (schedule.status !== "OPEN" && schedule.status !== "READY")
    )
      throw new ExamSessionError(
        "SCHEDULE_NOT_AVAILABLE",
        "Ujian utama belum tersedia.",
        409,
      );
  }

  private isWithinWindow(
    schedule: RuntimeScheduleRecord,
    now: UtcTimestamp,
  ): boolean {
    const current = Date.parse(now);
    return (
      schedule.status !== "CLOSED" &&
      schedule.status !== "ARCHIVED" &&
      current >= Date.parse(schedule.startsAt) &&
      current < Date.parse(schedule.endsAt)
    );
  }

  private ensureWritable(session: RuntimeSession, now: UtcTimestamp): void {
    if (session.status !== "ACTIVE") throw this.statusError(session.status);
    if (Date.parse(now) >= Date.parse(session.deadlineAt)) {
      this.finalizeSession(session, "DEADLINE", now);
      throw new ExamSessionError(
        "SESSION_EXPIRED",
        "Waktu ujian telah habis.",
        409,
        { finalizationReason: "DEADLINE" },
      );
    }
  }

  private assertSessionAccess(
    session: RuntimeSession,
    access: RuntimeSessionAccess | undefined,
  ): void {
    if (session.participantId !== null) {
      if (access?.participantId !== session.participantId)
        throw new ExamSessionError(
          "SCHEDULE_NOT_AVAILABLE",
          "Sesi ujian tidak tersedia.",
          409,
        );
      return;
    }
    if (
      !access?.practiceCredential ||
      !bytesEqual(
        access.practiceCredential,
        session.practiceCredentialHash ?? session.practiceTokenHash,
      )
    )
      throw new ExamSessionError(
        "AUTHENTICATION_REQUIRED",
        "Credential latihan diperlukan.",
        401,
      );
  }

  private touchSession(
    session: RuntimeSession,
    now: UtcTimestamp,
  ): RuntimeSession {
    if (session.status !== "ACTIVE" || session.lastSeenAt === now)
      return session;
    const updated = {
      ...session,
      lastSeenAt: now,
      updatedAt: now,
    } as RuntimeSession;
    this.sessions.set(session.id, updated);
    return updated;
  }

  private statusError(status: ExamSessionStatus): ExamSessionError {
    if (status === "EXPIRED")
      return new ExamSessionError(
        "SESSION_EXPIRED",
        "Waktu ujian telah habis.",
        409,
      );
    if (status === "ENDED")
      return new ExamSessionError(
        "SESSION_ENDED",
        "Sesi ujian telah diakhiri.",
        409,
      );
    return new ExamSessionError(
      "SESSION_SUBMITTED",
      "Sesi ujian sudah dikumpulkan.",
      409,
    );
  }

  private requireSchedule(id: Id): RuntimeScheduleRecord {
    const schedule = this.schedules.get(id);
    if (!schedule)
      throw new ExamSessionError(
        "SCHEDULE_NOT_AVAILABLE",
        "Jadwal ujian tidak tersedia.",
        409,
      );
    return schedule;
  }

  private requireSession(id: Id): RuntimeSession {
    const session = this.sessions.get(id);
    if (!session) throw new SessionNotFoundError();
    return session;
  }

  private requireSource(id: Id): RuntimeQuestionSource {
    const source = this.sources.get(id);
    if (!source)
      throw new ExamSessionError("SERVICE_BUSY", "Soal ujian belum siap.", 503);
    return source;
  }

  private timestamp(value?: UtcTimestamp): UtcTimestamp {
    return value ?? formatUtcTimestamp(new Date());
  }

  private nextId(): Id {
    this.idSequence += 1n;
    return formatId(this.idSequence);
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.lockTail;
    let release!: () => void;
    this.lockTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

function normalizePracticeIdentity(
  schedule: RuntimeScheduleRecord,
  input: StartPracticeInput,
): {
  readonly name: string;
  readonly classSnapshot: string | null | undefined;
  readonly institutionSnapshot: string | null | undefined;
  readonly extra: Readonly<Record<string, string>>;
} {
  const fields = Array.isArray(schedule.identityFields)
    ? (schedule.identityFields as readonly ScheduleIdentityField[])
    : [{ key: "name", label: "Nama", type: "TEXT" as const, required: true }];
  const values: Record<string, string> = {
    name: input.participantName,
    ...(input.classSnapshot ? { class: input.classSnapshot } : {}),
    ...(input.institutionSnapshot
      ? { institution: input.institutionSnapshot }
      : {}),
    ...(input.identityExtra ?? {}),
  };
  let normalized: Readonly<Record<string, string>>;
  try {
    normalized = normalizeIdentitySnapshot(fields, values).values;
  } catch (error) {
    throw new ExamSessionError(
      "INVALID_ANSWER_SHAPE",
      error instanceof Error ? error.message : "Identitas peserta tidak valid.",
      422,
    );
  }
  const {
    name,
    class: classSnapshot,
    institution: institutionSnapshot,
    ...extra
  } = normalized;
  return {
    name: name ?? input.participantName.trim(),
    classSnapshot,
    institutionSnapshot,
    extra,
  };
}

function assertAnswerItems(
  items: readonly (SessionAnswerItem | FinalAnswerItem)[],
  final: boolean,
): void {
  for (const item of items) {
    const candidate = item as unknown as Record<string, unknown> | null;
    if (
      !candidate ||
      typeof candidate.sessionQuestionId !== "string" ||
      !Number.isSafeInteger(candidate.baseVersion) ||
      Number(candidate.baseVersion) < 0 ||
      (!final &&
        (typeof candidate.clientMutationId !== "string" ||
          candidate.clientMutationId.length < 1 ||
          candidate.clientMutationId.length > 128))
    )
      throw new ExamSessionError(
        "INVALID_ANSWER_SHAPE",
        "Item jawaban tidak valid.",
        422,
      );
  }
}

function assertFinalAnswerItems(items: readonly FinalAnswerItem[]): void {
  assertAnswerItems(items, true);
}

function stableRecord(value: Readonly<Record<string, string>>): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(value).sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0,
      ),
    ),
  );
}

function bytesEqual(left: Uint8Array, right: Uint8Array | undefined): boolean {
  if (!right || left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1)
    result |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return result === 0;
}

function seedFor(seed: Uint8Array, index: number): Uint8Array {
  const copy = new Uint8Array(seed);
  copy[0] = ((copy[0] ?? 0) ^ index) & 0xff;
  copy[1] = ((copy[1] ?? 0) ^ (index >>> 8)) & 0xff;
  return copy;
}

function emptyResponse(
  source: RuntimeQuestionSource,
): import("../scoring").ScoringResponse {
  if (source.type === "SINGLE_CHOICE") return { selectedOptionId: null };
  if (source.type === "MULTIPLE_RESPONSE") return { selectedOptionIds: [] };
  return { statements: [] };
}
