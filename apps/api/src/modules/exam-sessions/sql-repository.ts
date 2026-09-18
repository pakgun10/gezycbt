import {
  formatId,
  formatUtcTimestamp,
  type Id,
  parseId,
  parseUtcTimestamp,
  type UtcTimestamp,
} from "@gezycbt/contracts";
import type { DatabaseConnection, DatabasePort } from "@gezycbt/database";
import type { ParticipantQuestionMedia } from "../questions/participant-presenter";
import type { ScheduleIdentityField } from "../schedules/domain";
import { normalizeIdentitySnapshot } from "../schedules/identity";
import { type ScoringQuestionSnapshot, ScoringService } from "../scoring";
import {
  calculateDeadline,
  type ExamResult,
  ExamSessionError,
  normalizeAnswerResponse,
  type ParticipantSessionView,
  participantManifest,
  type RuntimeAnswer,
  type RuntimeQuestionManifest,
  type RuntimeQuestionSource,
  type RuntimeSchedule,
  type RuntimeSession,
  SessionIdempotencyConflictError,
  type SessionStartResult,
} from "./domain";
import type {
  AttemptGrant,
  EndSessionInput,
  ResetAttemptInput,
  RuntimeQuestionDefinition,
  RuntimeScheduleRecord,
  RuntimeSessionAccess,
  RuntimeStore,
  ScheduleCloseInput,
  StartMainInput,
  StartPracticeInput,
  TimeExtensionInput,
} from "./repository";

type Row = Record<string, unknown>;

/** MariaDB persistence adapter for the immutable start/resume path. */
export class SqlExamRuntimeStore implements RuntimeStore {
  constructor(private readonly database: DatabasePort) {}
  private readonly scoring = new ScoringService();

  async startMain(input: StartMainInput): Promise<SessionStartResult> {
    return this.database.transaction(async (connection) => {
      const schedule = await readSchedule(connection, input.scheduleId, false);
      if (!schedule || schedule.mode !== "MAIN") throw unavailable();
      const participantName = input.participantName.trim();
      if (!participantName || participantName.length > 200)
        throw new ExamSessionError(
          "INVALID_ANSWER_SHAPE",
          "Nama peserta tidak valid.",
          422,
        );
      const now = input.now ?? serverNow();
      const replay = await readSessionByStartKey(
        connection,
        schedule.id,
        input.startIdempotencyKey,
        true,
      );
      if (replay) {
        if (
          replay.participantId !== input.participant.participantId ||
          replay.participantNameSnapshot !== participantName ||
          replay.classSnapshot !== (input.classSnapshot?.trim() || null) ||
          replay.institutionSnapshot !==
            (input.institutionSnapshot?.trim() || null) ||
          stableRecord(replay.identityExtra) !==
            stableRecord(input.identityExtra ?? {})
        )
          throw new SessionIdempotencyConflictError();
        return readStartResult(connection, replay, true, now);
      }
      if (
        !isOpen(schedule, now) ||
        !input.mainAccessCodeDigest ||
        !bytesEqual(input.mainAccessCodeDigest, schedule.mainAccessCodeHash)
      )
        throw unavailable();
      if (
        !(await isParticipantEligible(
          connection,
          schedule,
          input.participant.participantId,
          input.participant.participantClassIds,
        ))
      )
        throw unavailable();
      const participant = await connection.query<Row>(
        "SELECT id FROM users WHERE id = ? AND role = 'PARTICIPANT' AND status = 'ACTIVE' LIMIT 1 FOR UPDATE",
        [input.participant.participantId],
      );
      if (!participant[0]) throw unavailable();
      const active = await connection.query<Row>(
        "SELECT id FROM exam_sessions WHERE schedule_id = ? AND participant_id = ? AND status = 'ACTIVE' LIMIT 1 FOR UPDATE",
        [schedule.id, input.participant.participantId],
      );
      if (active[0])
        throw new ExamSessionError(
          "SESSION_ALREADY_ACTIVE",
          "Peserta masih memiliki sesi ujian aktif.",
          409,
          { sessionId: dbId(active[0].id) },
        );
      const grants = await connection.query<Row>(
        "SELECT id, granted_attempt_no FROM exam_attempt_grants WHERE schedule_id = ? AND participant_id = ? AND consumed_by_session_id IS NULL ORDER BY id ASC LIMIT 1 FOR UPDATE",
        [schedule.id, input.participant.participantId],
      );
      const previous = await connection.query<Row>(
        "SELECT COUNT(*) AS count FROM exam_sessions WHERE schedule_id = ? AND participant_id = ?",
        [schedule.id, input.participant.participantId],
      );
      const grant = grants[0];
      const attemptNo = grant
        ? Number(grant.granted_attempt_no)
        : Number(previous[0]?.count ?? 0) + 1;
      if (!grant && attemptNo > schedule.maxAttempts)
        throw new ExamSessionError(
          "ATTEMPT_LIMIT_REACHED",
          "Batas percobaan ujian sudah tercapai.",
          409,
        );
      const session = await insertSession(
        connection,
        schedule,
        { ...input, participantName },
        now,
        attemptNo,
        undefined,
      );
      await insertManifest(
        connection,
        session.id,
        schedule,
        session.randomSeed,
      );
      const currentSchedule = await readSchedule(
        connection,
        input.scheduleId,
        true,
      );
      if (
        !currentSchedule ||
        !isOpen(currentSchedule, now) ||
        !bytesEqual(
          input.mainAccessCodeDigest ?? new Uint8Array(),
          currentSchedule.mainAccessCodeHash,
        )
      )
        throw unavailable();
      if (grant) {
        const consumed = await connection.execute(
          "UPDATE exam_attempt_grants SET consumed_by_session_id = ?, consumed_at = ? WHERE id = ? AND consumed_by_session_id IS NULL",
          [session.id, now, grant.id],
        );
        if (consumed.affectedRows !== 1)
          throw new ExamSessionError(
            "RESET_NOT_ALLOWED",
            "Attempt reset sudah digunakan.",
            409,
          );
      }
      return readStartResult(connection, session, false, now);
    });
  }

  async resolvePractice(
    scheduleId: Id,
    tokenDigest: Uint8Array,
    now?: UtcTimestamp,
  ): Promise<RuntimeScheduleRecord | null> {
    return this.database.transaction(async (connection) => {
      const schedule = await readSchedule(connection, scheduleId, false);
      const timestamp = now ?? serverNow();
      if (
        !schedule ||
        schedule.mode !== "PRACTICE" ||
        !isOpen(schedule, timestamp) ||
        !bytesEqual(tokenDigest, schedule.practiceTokenHash)
      )
        return null;
      return schedule;
    });
  }

  async resolvePracticeByToken(
    tokenDigest: Uint8Array,
    now?: UtcTimestamp,
  ): Promise<RuntimeScheduleRecord | null> {
    return this.database.transaction(async (connection) => {
      const rows = await connection.query<Row>(
        "SELECT id FROM exam_schedules WHERE mode = 'PRACTICE' AND practice_token_hash = ? LIMIT 1",
        [tokenDigest],
      );
      if (!rows[0]) return null;
      const schedule = await readSchedule(connection, dbId(rows[0].id), false);
      const timestamp = now ?? serverNow();
      if (
        !schedule ||
        schedule.mode !== "PRACTICE" ||
        !isOpen(schedule, timestamp) ||
        !bytesEqual(tokenDigest, schedule.practiceTokenHash)
      )
        return null;
      return schedule;
    });
  }

  async startPractice(input: StartPracticeInput): Promise<SessionStartResult> {
    return this.database.transaction(async (connection) => {
      const schedule = await readSchedule(connection, input.scheduleId, false);
      const now = input.now ?? serverNow();
      if (
        !schedule ||
        schedule.mode !== "PRACTICE" ||
        !isOpen(schedule, now) ||
        !bytesEqual(input.practiceTokenDigest, schedule.practiceTokenHash)
      )
        throw new ExamSessionError(
          "PRACTICE_ACCESS_INVALID",
          "Token atau jadwal latihan tidak valid.",
          401,
        );
      const replay = await readSessionByStartKey(
        connection,
        schedule.id,
        input.startIdempotencyKey,
        true,
      );
      const fields = Array.isArray(schedule.identityFields)
        ? (schedule.identityFields as readonly ScheduleIdentityField[])
        : [
            {
              key: "name",
              label: "Nama",
              type: "TEXT" as const,
              required: true,
            },
          ];
      let identity: Readonly<Record<string, string>>;
      try {
        identity = normalizeIdentitySnapshot(fields, {
          name: input.participantName,
          ...(input.classSnapshot ? { class: input.classSnapshot } : {}),
          ...(input.institutionSnapshot
            ? { institution: input.institutionSnapshot }
            : {}),
          ...(input.identityExtra ?? {}),
        }).values;
      } catch (error) {
        throw new ExamSessionError(
          "INVALID_ANSWER_SHAPE",
          error instanceof Error
            ? error.message
            : "Identitas peserta tidak valid.",
          422,
        );
      }
      const normalizedExtra = Object.fromEntries(
        Object.entries(identity).filter(
          ([key]) => !["name", "class", "institution"].includes(key),
        ),
      );
      if (replay) {
        if (
          replay.participantId !== null ||
          replay.participantNameSnapshot !== identity.name ||
          replay.classSnapshot !== (identity.class ?? null) ||
          replay.institutionSnapshot !== (identity.institution ?? null) ||
          stableRecord(replay.identityExtra) !== stableRecord(normalizedExtra)
        )
          throw new SessionIdempotencyConflictError();
        return readStartResult(connection, replay, true, now);
      }
      const session = await insertSession(
        connection,
        schedule,
        {
          ...input,
          participantName: identity.name ?? input.participantName,
          classSnapshot: identity.class ?? null,
          institutionSnapshot: identity.institution ?? null,
          identityExtra: normalizedExtra,
        },
        now,
        1,
        input.practiceTokenDigest,
        input.practiceCredentialDigest,
      );
      await insertManifest(
        connection,
        session.id,
        schedule,
        session.randomSeed,
      );
      const currentSchedule = await readSchedule(
        connection,
        input.scheduleId,
        true,
      );
      if (
        !currentSchedule ||
        !isOpen(currentSchedule, now) ||
        !bytesEqual(
          input.practiceTokenDigest,
          currentSchedule.practiceTokenHash,
        )
      )
        throw new ExamSessionError(
          "PRACTICE_ACCESS_INVALID",
          "Token atau jadwal latihan tidak valid.",
          401,
        );
      return readStartResult(connection, session, false, now);
    });
  }

  async getParticipantSession(
    sessionId: Id,
    participantId?: Id,
    practiceCredential?: Uint8Array,
    now?: UtcTimestamp,
  ): Promise<ParticipantSessionView> {
    return this.database.transaction(async (connection) => {
      let session = await readSession(connection, sessionId, true);
      if (!session)
        throw new ExamSessionError(
          "SCHEDULE_NOT_AVAILABLE",
          "Sesi ujian tidak ditemukan.",
          404,
        );
      assertSessionAccess(session, {
        ...(participantId === undefined ? {} : { participantId }),
        ...(practiceCredential === undefined ? {} : { practiceCredential }),
      });
      const timestamp = now ?? serverNow();
      if (
        session.status === "ACTIVE" &&
        Date.parse(timestamp) >= Date.parse(session.deadlineAt)
      ) {
        const finalized = await finalizeSqlSession(
          connection,
          session,
          "DEADLINE",
          timestamp,
          this.scoring,
        );
        session = finalized.session;
      }
      const manifest = await readManifest(connection, session);
      const answers = await readAnswers(connection, session.id);
      return safeView(session, manifest, answers, timestamp);
    });
  }

  async saveAnswers(
    sessionId: Id,
    items: readonly import("./domain").SessionAnswerItem[],
    now?: UtcTimestamp,
    access?: RuntimeSessionAccess,
  ): Promise<import("./domain").BatchAnswerResult> {
    if (!Array.isArray(items) || items.length === 0 || items.length > 20)
      throw new ExamSessionError(
        "INVALID_ANSWER_SHAPE",
        "Batch jawaban harus berisi 1 sampai 20 item.",
        422,
      );
    assertAnswerItems(items, false);
    return this.database.transaction(async (connection) => {
      let session = await readSession(connection, sessionId, true);
      if (!session)
        throw new ExamSessionError(
          "SCHEDULE_NOT_AVAILABLE",
          "Sesi ujian tidak ditemukan.",
          404,
        );
      assertSessionAccess(session, access);
      const timestamp = now ?? serverNow();
      if (Date.parse(timestamp) >= Date.parse(session.deadlineAt)) {
        await finalizeSqlSession(
          connection,
          session,
          "DEADLINE",
          timestamp,
          this.scoring,
        );
        throw new ExamSessionError(
          "SESSION_EXPIRED",
          "Waktu ujian telah habis.",
          409,
          { finalizationReason: "DEADLINE" },
        );
      }
      if (session.status !== "ACTIVE") throw statusError(session.status);
      const manifest = await readManifest(connection, session);
      const current = new Map(
        (await readAnswers(connection, session.id)).map((answer) => [
          answer.sessionQuestionId,
          answer,
        ]),
      );
      const outcomes: Array<
        import("./domain").BatchAnswerResult["outcomes"][number]
      > = [];
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
        const source = await readQuestionSource(
          connection,
          manifestItem.questionRevisionId,
        );
        const response = normalizeAnswerResponse(
          source,
          item.response,
          manifestItem.optionOrder.length
            ? manifestItem.optionOrder
            : manifestItem.statementOrder,
        );
        const existing = current.get(item.sessionQuestionId);
        const version = existing?.version ?? 0;
        if (item.baseVersion !== version) {
          outcomes.push({
            sessionQuestionId: item.sessionQuestionId,
            clientMutationId: item.clientMutationId,
            status: "CONFLICT",
            version,
            response: existing?.response ?? emptyResponse(source),
          });
          continue;
        }
        if (
          existing &&
          JSON.stringify(existing.response) === JSON.stringify(response)
        ) {
          outcomes.push({
            sessionQuestionId: item.sessionQuestionId,
            clientMutationId: item.clientMutationId,
            status: "UNCHANGED",
            version,
          });
          continue;
        }
        const nextVersion = version + 1;
        if (existing)
          await connection.execute(
            "UPDATE answers SET response_json = ?, version = ?, answered_at = ? WHERE session_id = ? AND session_question_id = ? AND version = ?",
            [
              JSON.stringify(response),
              nextVersion,
              timestamp,
              session.id,
              item.sessionQuestionId,
              version,
            ],
          );
        else
          await connection.execute(
            "INSERT INTO answers (session_id, session_question_id, response_json, version, answered_at) VALUES (?, ?, ?, ?, ?)",
            [
              session.id,
              item.sessionQuestionId,
              JSON.stringify(response),
              nextVersion,
              timestamp,
            ],
          );
        const answer: RuntimeAnswer = {
          sessionId: session.id,
          sessionQuestionId: item.sessionQuestionId,
          response,
          version: nextVersion,
          answeredAt: timestamp,
        };
        current.set(item.sessionQuestionId, answer);
        outcomes.push({
          sessionQuestionId: item.sessionQuestionId,
          clientMutationId: item.clientMutationId,
          status: "SAVED",
          version: nextVersion,
        });
      }
      await connection.execute(
        "UPDATE exam_sessions SET last_seen_at = ?, version = version + 1, updated_at = ? WHERE id = ? AND status = 'ACTIVE'",
        [timestamp, timestamp, session.id],
      );
      session = {
        ...session,
        lastSeenAt: timestamp,
        updatedAt: timestamp,
        version: session.version + 1,
      };
      return {
        sessionId: session.id,
        outcomes,
        serverNow: timestamp,
        deadlineAt: session.deadlineAt,
      };
    });
  }

  async submit(
    sessionId: Id,
    finalAnswers: readonly import("./domain").FinalAnswerItem[],
    idempotencyKey: string,
    now?: UtcTimestamp,
    access?: RuntimeSessionAccess,
  ): Promise<import("./domain").SubmitResult> {
    if (!Array.isArray(finalAnswers) || finalAnswers.length > 500)
      throw new ExamSessionError(
        "INVALID_ANSWER_SHAPE",
        "Final answers tidak valid.",
        422,
      );
    if (idempotencyKey.trim().length < 16 || idempotencyKey.length > 128)
      throw new ExamSessionError(
        "INVALID_ANSWER_SHAPE",
        "Idempotency key tidak valid.",
        422,
      );
    return this.database.transaction(async (connection) => {
      const session = await readSession(connection, sessionId, true);
      if (!session)
        throw new ExamSessionError(
          "SCHEDULE_NOT_AVAILABLE",
          "Sesi ujian tidak ditemukan.",
          404,
        );
      assertSessionAccess(session, access);
      assertFinalAnswerItems(finalAnswers);
      const timestamp = now ?? serverNow();
      if (session.status !== "ACTIVE") {
        const result = await readResult(connection, session.id);
        if (result)
          return { session, result, serverNow: timestamp, replayed: true };
        throw statusError(session.status);
      }
      if (Date.parse(timestamp) >= Date.parse(session.deadlineAt)) {
        const finalized = await finalizeSqlSession(
          connection,
          session,
          "DEADLINE",
          timestamp,
          this.scoring,
        );
        return { ...finalized, serverNow: timestamp, replayed: false };
      }
      const manifest = await readManifest(connection, session);
      const current = new Map(
        (await readAnswers(connection, session.id)).map((answer) => [
          answer.sessionQuestionId,
          answer,
        ]),
      );
      const seen = new Set<Id>();
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
        const source = await readQuestionSource(
          connection,
          manifestItem.questionRevisionId,
        );
        const response = normalizeAnswerResponse(
          source,
          item.response,
          manifestItem.optionOrder.length
            ? manifestItem.optionOrder
            : manifestItem.statementOrder,
        );
        const existing = current.get(item.sessionQuestionId);
        const version = existing?.version ?? 0;
        if (item.baseVersion !== version)
          throw new ExamSessionError(
            "ANSWER_VERSION_CONFLICT",
            "Jawaban berubah di perangkat lain.",
            409,
            {
              sessionQuestionId: item.sessionQuestionId,
              version,
              response: existing?.response ?? emptyResponse(source),
            },
          );
        const nextVersion = version + 1;
        if (existing)
          await connection.execute(
            "UPDATE answers SET response_json = ?, version = ?, answered_at = ? WHERE session_id = ? AND session_question_id = ? AND version = ?",
            [
              JSON.stringify(response),
              nextVersion,
              timestamp,
              session.id,
              item.sessionQuestionId,
              version,
            ],
          );
        else
          await connection.execute(
            "INSERT INTO answers (session_id, session_question_id, response_json, version, answered_at) VALUES (?, ?, ?, ?, ?)",
            [
              session.id,
              item.sessionQuestionId,
              JSON.stringify(response),
              nextVersion,
              timestamp,
            ],
          );
      }
      const finalized = await finalizeSqlSession(
        connection,
        session,
        "PARTICIPANT_SUBMIT",
        timestamp,
        this.scoring,
      );
      return { ...finalized, serverNow: timestamp, replayed: false };
    });
  }

  async finalizeDue(now?: UtcTimestamp, limit = 50): Promise<readonly Id[]> {
    return this.database.transaction(async (connection) => {
      const timestamp = now ?? serverNow();
      const rows = await connection.query<Row>(
        "SELECT id FROM exam_sessions WHERE status = 'ACTIVE' AND deadline_at <= ? ORDER BY deadline_at ASC, id ASC LIMIT ?",
        [timestamp, Math.max(1, Math.min(100, limit))],
      );
      const ids: Id[] = [];
      for (const row of rows) {
        const session = await readSession(connection, dbId(row.id), true);
        if (
          session?.status === "ACTIVE" &&
          Date.parse(session.deadlineAt) <= Date.parse(timestamp)
        ) {
          await finalizeSqlSession(
            connection,
            session,
            "DEADLINE",
            timestamp,
            this.scoring,
          );
          ids.push(session.id);
        }
      }
      return ids;
    });
  }

  async extendTime(input: TimeExtensionInput): Promise<RuntimeSession> {
    return this.database.transaction(async (connection) => {
      if (
        !Number.isSafeInteger(input.additionalMinutes) ||
        input.additionalMinutes <= 0 ||
        input.additionalMinutes > 1440
      )
        throw new ExamSessionError(
          "TIME_EXTENSION_INVALID",
          "Perpanjangan waktu harus berupa menit positif.",
          422,
        );
      if (!input.reason.trim() || input.reason.trim().length > 500)
        throw new ExamSessionError(
          "TIME_EXTENSION_INVALID",
          "Alasan perpanjangan wajib diisi.",
          422,
        );
      const session = await readSession(connection, input.sessionId, true);
      if (!session)
        throw new ExamSessionError(
          "SCHEDULE_NOT_AVAILABLE",
          "Sesi ujian tidak ditemukan.",
          404,
        );
      if (session.status !== "ACTIVE") throw statusError(session.status);
      if (session.version !== input.expectedVersion)
        throw new ExamSessionError(
          "ANSWER_VERSION_CONFLICT",
          "Sesi sudah berubah.",
          409,
          { version: session.version },
        );
      const schedule = await readSchedule(
        connection,
        session.scheduleId,
        false,
      );
      if (!schedule)
        throw new ExamSessionError(
          "SCHEDULE_NOT_AVAILABLE",
          "Jadwal ujian tidak tersedia.",
          409,
        );
      const timestamp = input.now ?? serverNow();
      const deadline = calculateDeadline(
        session.deadlineAt,
        input.additionalMinutes * 60,
        schedule.endsAt,
      );
      await connection.execute(
        "UPDATE exam_sessions SET deadline_at = ?, version = version + 1, updated_at = ? WHERE id = ? AND status = 'ACTIVE' AND version = ?",
        [deadline, timestamp, session.id, input.expectedVersion],
      );
      return {
        ...session,
        deadlineAt: deadline,
        version: session.version + 1,
        updatedAt: timestamp,
      };
    });
  }

  async endSession(
    input: EndSessionInput,
  ): Promise<import("./domain").SubmitResult> {
    return this.database.transaction(async (connection) => {
      const session = await readSession(connection, input.sessionId, true);
      if (!session)
        throw new ExamSessionError(
          "SCHEDULE_NOT_AVAILABLE",
          "Sesi ujian tidak ditemukan.",
          404,
        );
      const timestamp = input.now ?? serverNow();
      if (session.status !== "ACTIVE") {
        const result = await readResult(connection, session.id);
        if (result)
          return { session, result, serverNow: timestamp, replayed: true };
        throw statusError(session.status);
      }
      if (
        input.expectedVersion !== undefined &&
        input.expectedVersion !== session.version
      )
        throw new ExamSessionError(
          "ANSWER_VERSION_CONFLICT",
          "Sesi sudah berubah.",
          409,
          { version: session.version },
        );
      if (!input.reason.trim() || input.reason.trim().length > 500)
        throw new ExamSessionError(
          "INVALID_ANSWER_SHAPE",
          "Alasan mengakhiri sesi wajib diisi.",
          422,
        );
      const finalized = await finalizeSqlSession(
        connection,
        session,
        "STAFF_END",
        timestamp,
        this.scoring,
        input.actorUserId,
        input.reason.trim(),
      );
      return { ...finalized, serverNow: timestamp, replayed: false };
    });
  }

  async closeSchedule(
    input: ScheduleCloseInput,
  ): Promise<RuntimeScheduleRecord> {
    return this.database.transaction(async (connection) => {
      const schedule = await readSchedule(connection, input.scheduleId, true);
      if (!schedule)
        throw new ExamSessionError(
          "SCHEDULE_NOT_AVAILABLE",
          "Jadwal ujian tidak tersedia.",
          409,
        );
      const timestamp = input.now ?? serverNow();
      if (
        input.expectedUpdatedAt &&
        schedule.updatedAt &&
        input.expectedUpdatedAt !== schedule.updatedAt
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
      await connection.execute(
        "UPDATE exam_schedules SET status = 'CLOSED', closed_at = ?, closed_by_user_id = ?, close_reason = ?, updated_at = ? WHERE id = ? AND status NOT IN ('CLOSED', 'ARCHIVED')",
        [
          timestamp,
          input.actorUserId ?? null,
          input.reason?.trim() ?? null,
          timestamp,
          input.scheduleId,
        ],
      );
      const sessions = await connection.query<Row>(
        "SELECT id FROM exam_sessions WHERE schedule_id = ? AND status = 'ACTIVE' ORDER BY id FOR UPDATE",
        [input.scheduleId],
      );
      for (const row of sessions) {
        const session = await readSession(connection, dbId(row.id), true);
        if (session?.status === "ACTIVE")
          await finalizeSqlSession(
            connection,
            session,
            "SCHEDULE_CLOSE",
            timestamp,
            this.scoring,
            input.actorUserId ?? undefined,
            input.reason?.trim(),
          );
      }
      return { ...schedule, status: "CLOSED", updatedAt: timestamp };
    });
  }

  async resetAttempt(input: ResetAttemptInput): Promise<AttemptGrant> {
    return this.database.transaction(async (connection) => {
      if (!input.reason.trim() || input.reason.trim().length > 500)
        throw new ExamSessionError(
          "RESET_NOT_ALLOWED",
          "Alasan reset wajib diisi.",
          422,
        );
      const schedule = await readSchedule(connection, input.scheduleId, true);
      if (!schedule || schedule.mode !== "MAIN")
        throw new ExamSessionError(
          "RESET_NOT_ALLOWED",
          "Reset attempt hanya tersedia untuk ujian utama.",
          409,
        );
      const existing = await connection.query<Row>(
        "SELECT * FROM exam_attempt_grants WHERE schedule_id = ? AND reset_idempotency_key = ? LIMIT 1 FOR UPDATE",
        [input.scheduleId, input.resetIdempotencyKey],
      );
      if (existing[0]) return mapGrant(existing[0]);
      const pending = await connection.query<Row>(
        "SELECT id FROM exam_attempt_grants WHERE schedule_id = ? AND participant_id = ? AND consumed_by_session_id IS NULL LIMIT 1 FOR UPDATE",
        [input.scheduleId, input.participantId],
      );
      if (pending[0])
        throw new ExamSessionError(
          "RESET_NOT_ALLOWED",
          "Peserta sudah memiliki attempt baru yang tersedia.",
          409,
        );
      const rows = await connection.query<Row>(
        "SELECT * FROM exam_sessions WHERE schedule_id = ? AND participant_id = ? ORDER BY attempt_no DESC LIMIT 1 FOR UPDATE",
        [input.scheduleId, input.participantId],
      );
      if (!rows[0])
        throw new ExamSessionError(
          "RESET_NOT_ALLOWED",
          "Belum ada attempt yang dapat direset.",
          409,
        );
      const source = mapSession(rows[0]);
      const pendingAfterSourceLock = await connection.query<Row>(
        "SELECT id FROM exam_attempt_grants WHERE schedule_id = ? AND participant_id = ? AND consumed_by_session_id IS NULL LIMIT 1 FOR UPDATE",
        [input.scheduleId, input.participantId],
      );
      if (pendingAfterSourceLock[0])
        throw new ExamSessionError(
          "RESET_NOT_ALLOWED",
          "Peserta sudah memiliki attempt baru yang tersedia.",
          409,
        );
      const timestamp = input.now ?? serverNow();
      if (source.status === "ACTIVE")
        await finalizeSqlSession(
          connection,
          source,
          "RESET_ATTEMPT",
          timestamp,
          this.scoring,
          input.actorUserId,
          input.reason.trim(),
        );
      const result = await connection.execute(
        "INSERT INTO exam_attempt_grants (schedule_id, participant_id, source_session_id, granted_attempt_no, reason, granted_by_user_id, reset_idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          input.scheduleId,
          input.participantId,
          source.id,
          source.attemptNo + 1,
          input.reason.trim(),
          input.actorUserId,
          input.resetIdempotencyKey,
        ],
      );
      if (result.insertId === undefined)
        throw new Error("Attempt grant insert did not return an ID");
      return {
        id: formatId(result.insertId),
        scheduleId: input.scheduleId,
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
    });
  }

  async getResult(sessionId: Id): Promise<ExamResult | null> {
    return this.database.transaction((connection) =>
      readResult(connection, sessionId),
    );
  }
}

async function readSchedule(
  connection: DatabaseConnection,
  scheduleId: Id,
  lock: boolean,
): Promise<RuntimeScheduleRecord | null> {
  const rows = await connection.query<Row>(
    `SELECT es.id, es.exam_revision_id, es.mode, es.status, es.starts_at, es.ends_at, es.duration_seconds, es.max_attempts, es.hard_end, es.allow_late_start, es.result_release_policy, es.practice_token_hash, es.main_access_code_hash, es.identity_fields_json, es.updated_at, er.title, er.instructions_html, er.shuffle_questions, er.shuffle_options FROM exam_schedules es JOIN exam_revisions er ON er.id = es.exam_revision_id WHERE es.id = ? LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [scheduleId],
  );
  if (!rows[0]) return null;
  const row = rows[0];
  const mainAccessCodeHash = bytes(row.main_access_code_hash);
  const practiceTokenHash = bytes(row.practice_token_hash);
  const definitions = await connection.query<Row>(
    "SELECT question_revision_id, points FROM exam_questions WHERE exam_revision_id = ? ORDER BY position ASC, id ASC",
    [row.exam_revision_id],
  );
  const classes = await connection.query<Row>(
    "SELECT class_id FROM exam_schedule_classes WHERE schedule_id = ? ORDER BY class_id",
    [scheduleId],
  );
  const participants = await connection.query<Row>(
    "SELECT participant_id FROM exam_schedule_participants WHERE schedule_id = ? ORDER BY participant_id",
    [scheduleId],
  );
  return {
    id: dbId(row.id),
    examRevisionId: dbId(row.exam_revision_id),
    mode: String(row.mode) as RuntimeSchedule["mode"],
    status: String(row.status) as RuntimeSchedule["status"],
    startsAt: dbTimestamp(row.starts_at),
    endsAt: dbTimestamp(row.ends_at),
    durationSeconds: Number(row.duration_seconds),
    maxAttempts: Number(row.max_attempts),
    hardEnd: true,
    allowLateStart: databaseBoolean(row.allow_late_start),
    resultReleasePolicy: String(
      row.result_release_policy,
    ) as RuntimeSchedule["resultReleasePolicy"],
    examTitle: String(row.title),
    instructionsHtml: String(row.instructions_html),
    shuffleQuestions: databaseBoolean(row.shuffle_questions),
    shuffleOptions: databaseBoolean(row.shuffle_options),
    ...(mainAccessCodeHash ? { mainAccessCodeHash } : {}),
    ...(practiceTokenHash ? { practiceTokenHash } : {}),
    identityFields: parseJson(row.identity_fields_json),
    targetClassIds: classes.map((item) => dbId(item.class_id)),
    targetParticipantIds: participants.map((item) => dbId(item.participant_id)),
    updatedAt: dbTimestamp(row.updated_at),
    questionDefinitions: definitions.map((item) => ({
      questionRevisionId: dbId(item.question_revision_id),
      points: String(item.points),
    })),
  };
}

async function isParticipantEligible(
  connection: DatabaseConnection,
  schedule: RuntimeScheduleRecord,
  participantId: Id,
  participantClassIds: readonly Id[],
): Promise<boolean> {
  const user = await connection.query<Row>(
    "SELECT id FROM users WHERE id = ? AND role = 'PARTICIPANT' AND status = 'ACTIVE' LIMIT 1",
    [participantId],
  );
  if (!user[0]) return false;
  if (schedule.targetParticipantIds.includes(participantId)) return true;
  if (!schedule.targetClassIds.length) return false;
  const active = await connection.query<Row>(
    `SELECT class_id FROM class_members WHERE participant_id = ? AND left_at IS NULL AND class_id IN (${schedule.targetClassIds.map(() => "?").join(",")})`,
    [participantId, ...schedule.targetClassIds],
  );
  return active.some(
    (row) =>
      participantClassIds.includes(dbId(row.class_id)) ||
      schedule.targetClassIds.includes(dbId(row.class_id)),
  );
}

async function insertSession(
  connection: DatabaseConnection,
  schedule: RuntimeScheduleRecord,
  input: {
    readonly participantId?: Id | null;
    readonly participantName: string;
    readonly classSnapshot?: string | null;
    readonly institutionSnapshot?: string | null;
    readonly identityExtra?: Readonly<Record<string, string>>;
    readonly startIdempotencyKey: string;
  },
  now: UtcTimestamp,
  attemptNo: number,
  practiceTokenHash: Uint8Array | undefined,
  practiceCredentialHash?: Uint8Array,
): Promise<RuntimeSession> {
  const seed = new Uint8Array(32);
  crypto.getRandomValues(seed);
  const deadline = calculateDeadline(
    now,
    schedule.durationSeconds,
    schedule.endsAt,
  );
  const result = await connection.execute(
    "INSERT INTO exam_sessions (schedule_id, exam_revision_id, participant_id, attempt_no, status, start_idempotency_key, practice_access_token_hash, practice_session_credential_hash, participant_name_snapshot, class_snapshot, institution_snapshot, identity_extra_json, random_seed, started_at, deadline_at, last_seen_at) VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      schedule.id,
      schedule.examRevisionId,
      input.participantId ?? null,
      attemptNo,
      input.startIdempotencyKey,
      practiceTokenHash ?? null,
      practiceCredentialHash ?? practiceTokenHash ?? null,
      input.participantName.trim(),
      input.classSnapshot ?? null,
      input.institutionSnapshot ?? null,
      input.identityExtra ? JSON.stringify(input.identityExtra) : null,
      seed,
      now,
      deadline,
      now,
    ],
  );
  if (result.insertId === undefined)
    throw new Error("Session insert did not return an ID");
  const credentialHash = practiceCredentialHash ?? practiceTokenHash;
  return {
    id: formatId(result.insertId),
    scheduleId: schedule.id,
    examRevisionId: schedule.examRevisionId,
    participantId: input.participantId ?? null,
    attemptNo,
    status: "ACTIVE",
    startedAt: now,
    deadlineAt: deadline,
    lastSeenAt: now,
    submittedAt: null,
    expiredAt: null,
    endedAt: null,
    scoredAt: null,
    finalizationReason: null,
    finalizedByUserId: null,
    finalizationNote: null,
    participantNameSnapshot: input.participantName.trim(),
    classSnapshot: input.classSnapshot ?? null,
    institutionSnapshot: input.institutionSnapshot ?? null,
    identityExtra: input.identityExtra ?? {},
    randomSeed: seed,
    startIdempotencyKey: input.startIdempotencyKey,
    practice: practiceTokenHash !== undefined,
    ...(practiceTokenHash
      ? { practiceTokenHash: new Uint8Array(practiceTokenHash) }
      : {}),
    ...(credentialHash
      ? { practiceCredentialHash: new Uint8Array(credentialHash) }
      : {}),
    version: 1,
    updatedAt: now,
  };
}

async function insertManifest(
  connection: DatabaseConnection,
  sessionId: Id,
  schedule: RuntimeScheduleRecord,
  seed: Uint8Array,
): Promise<void> {
  const definitions = schedule.shuffleQuestions
    ? deterministicShuffleDefinitions(schedule.questionDefinitions, seed)
    : [...schedule.questionDefinitions];
  const placeholders: string[] = [];
  const parameters: unknown[] = [];
  // Read the immutable question sources first, then write the manifest once.
  // This keeps one session start to one manifest INSERT regardless of question count.
  for (let index = 0; index < definitions.length; index += 1) {
    const definition = definitions[index];
    if (!definition) continue;
    const source = await readQuestionSource(
      connection,
      definition.questionRevisionId,
    );
    const optionOrder =
      source.type === "TRUE_FALSE"
        ? null
        : JSON.stringify(
            schedule.shuffleOptions
              ? deterministicShuffleIds(
                  source.options.map((option) => option.id),
                  seed,
                  index,
                )
              : source.options.map((option) => option.id),
          );
    const statementOrder = JSON.stringify(
      source.statements.map((statement) => statement.id),
    );
    placeholders.push("(?, ?, ?, ?, ?, ?)");
    parameters.push(
      sessionId,
      definition.questionRevisionId,
      index + 1,
      definition.points,
      optionOrder,
      statementOrder,
    );
  }
  if (placeholders.length > 0)
    await connection.execute(
      `INSERT INTO exam_session_questions (session_id, question_revision_id, display_position, points, option_order_json, statement_order_json) VALUES ${placeholders.join(", ")}`,
      parameters,
    );
}

async function readStartResult(
  connection: DatabaseConnection,
  session: RuntimeSession,
  replayed: boolean,
  now: UtcTimestamp,
): Promise<SessionStartResult> {
  const manifest = await readManifest(connection, session);
  return { session, manifest, serverNow: now, replayed };
}

async function readSessionByStartKey(
  connection: DatabaseConnection,
  scheduleId: Id,
  key: string,
  lock: boolean,
): Promise<RuntimeSession | null> {
  const rows = await connection.query<Row>(
    `SELECT * FROM exam_sessions WHERE schedule_id = ? AND start_idempotency_key = ? LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [scheduleId, key],
  );
  return rows[0] ? mapSession(rows[0]) : null;
}

async function readSession(
  connection: DatabaseConnection,
  id: Id,
  lock: boolean,
): Promise<RuntimeSession | null> {
  const rows = await connection.query<Row>(
    `SELECT * FROM exam_sessions WHERE id = ? LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [id],
  );
  return rows[0] ? mapSession(rows[0]) : null;
}

async function readManifest(
  connection: DatabaseConnection,
  session: RuntimeSession,
): Promise<RuntimeQuestionManifest[]> {
  const rows = await connection.query<Row>(
    "SELECT id, question_revision_id, display_position, points, option_order_json, statement_order_json FROM exam_session_questions WHERE session_id = ? ORDER BY display_position",
    [session.id],
  );
  const result: RuntimeQuestionManifest[] = [];
  for (const row of rows) {
    const source = await readQuestionSource(
      connection,
      dbId(row.question_revision_id),
    );
    result.push(
      participantManifest(source, {
        sessionQuestionId: dbId(row.id),
        questionId: source.questionId,
        questionRevisionId: source.questionRevisionId,
        displayPosition: Number(row.display_position),
        points: String(row.points),
        optionOrder: parseJsonArray(row.option_order_json),
        statementOrder: parseJsonArray(row.statement_order_json),
      }),
    );
  }
  return result;
}

async function readQuestionSource(
  connection: DatabaseConnection,
  revisionId: Id,
): Promise<RuntimeQuestionSource> {
  const rows = await connection.query<Row>(
    "SELECT qr.id, qr.question_id, qr.type, qr.stimulus_html, qr.prompt_html FROM question_revisions qr WHERE qr.id = ? AND qr.status = 'PUBLISHED' LIMIT 1",
    [revisionId],
  );
  if (!rows[0])
    throw new ExamSessionError("SERVICE_BUSY", "Soal ujian belum siap.", 503);
  const row = rows[0];
  const options = await connection.query<Row>(
    "SELECT id, position, content_html, is_correct FROM question_options WHERE question_revision_id = ? ORDER BY position",
    [revisionId],
  );
  const statements = await connection.query<Row>(
    "SELECT id, position, statement_html, correct_value FROM true_false_statements WHERE question_revision_id = ? ORDER BY position",
    [revisionId],
  );
  const media = await connection.query<Row>(
    "SELECT qrm.media_asset_id, qrm.`usage`, qrm.alt_text, qrm.is_decorative FROM question_revision_media qrm JOIN media_assets ma ON ma.id = qrm.media_asset_id WHERE qrm.question_revision_id = ? AND ma.status = 'READY' ORDER BY qrm.media_asset_id",
    [revisionId],
  );
  return {
    questionId: dbId(row.question_id),
    questionRevisionId: dbId(row.id),
    type: String(row.type) as RuntimeQuestionSource["type"],
    stimulusHtml: String(row.stimulus_html),
    promptHtml: row.prompt_html === null ? null : String(row.prompt_html),
    options: options.map((item) => ({
      id: dbId(item.id),
      position: Number(item.position),
      contentHtml: String(item.content_html),
      isCorrect: databaseBoolean(item.is_correct),
    })),
    statements: statements.map((item) => ({
      id: dbId(item.id),
      position: Number(item.position),
      statementHtml: String(item.statement_html),
      correctValue: databaseBoolean(item.correct_value),
    })),
    media: media.map((item) => ({
      usage: String(item.usage) as ParticipantQuestionMedia["usage"],
      url: `/api/v1/participant/media/${dbId(item.media_asset_id)}`,
      altText: item.alt_text == null ? null : String(item.alt_text),
      isDecorative: databaseBoolean(item.is_decorative),
    })),
  };
}

async function readAnswers(
  connection: DatabaseConnection,
  sessionId: Id,
): Promise<RuntimeAnswer[]> {
  const rows = await connection.query<Row>(
    "SELECT session_id, session_question_id, response_json, version, answered_at FROM answers WHERE session_id = ? ORDER BY session_question_id",
    [sessionId],
  );
  return rows.map((row) => ({
    sessionId: dbId(row.session_id),
    sessionQuestionId: dbId(row.session_question_id),
    response: JSON.parse(
      String(row.response_json),
    ) as RuntimeAnswer["response"],
    version: Number(row.version),
    answeredAt: dbTimestamp(row.answered_at),
  }));
}

async function finalizeSqlSession(
  connection: DatabaseConnection,
  session: RuntimeSession,
  reason: import("./domain").FinalizationReason,
  now: UtcTimestamp,
  scoring: ScoringService,
  actorUserId?: Id,
  note?: string,
): Promise<{ session: RuntimeSession; result: ExamResult }> {
  const manifest = await readManifest(connection, session);
  const answers = await readAnswers(connection, session.id);
  const answerBySessionQuestion = new Map(
    answers.map((answer) => [answer.sessionQuestionId, answer]),
  );
  const snapshots: ScoringQuestionSnapshot[] = [];
  for (const item of manifest) {
    const source = await readQuestionSource(
      connection,
      item.questionRevisionId,
    );
    snapshots.push({
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
    });
  }
  const scoringAnswers = manifest.flatMap((item) => {
    const answer = answerBySessionQuestion.get(item.sessionQuestionId);
    return answer
      ? [{ questionId: item.questionId, response: answer.response }]
      : [];
  });
  const score = scoring.score({
    questions: snapshots,
    answers: scoringAnswers,
  });
  const submittedAt = reason === "PARTICIPANT_SUBMIT" ? now : null;
  const expiredAt = reason === "DEADLINE" ? now : null;
  const endedAt = ["SCHEDULE_CLOSE", "STAFF_END", "RESET_ATTEMPT"].includes(
    reason,
  )
    ? now
    : null;
  await connection.execute(
    "UPDATE exam_sessions SET status = 'SCORED', submitted_at = COALESCE(?, submitted_at), expired_at = COALESCE(?, expired_at), ended_at = COALESCE(?, ended_at), scored_at = ?, finalization_reason = ?, finalized_by_user_id = ?, finalization_note = ?, last_seen_at = ?, version = version + 1, updated_at = ? WHERE id = ? AND status = 'ACTIVE'",
    [
      submittedAt,
      expiredAt,
      endedAt,
      now,
      reason,
      actorUserId ?? null,
      note ?? null,
      now,
      now,
      session.id,
    ],
  );
  const scheduleRows = await connection.query<Row>(
    "SELECT mode, result_release_policy FROM exam_schedules WHERE id = ? LIMIT 1",
    [session.scheduleId],
  );
  const releasedAt =
    scheduleRows[0]?.result_release_policy === "IMMEDIATE_SCORE" ? now : null;
  await connection.execute(
    "INSERT INTO exam_results (session_id, schedule_id, participant_id, correct_count, incorrect_count, unanswered_count, earned_score, max_score, percentage, scored_at, released_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE session_id = session_id",
    [
      session.id,
      session.scheduleId,
      session.participantId,
      score.correctCount,
      score.incorrectCount,
      score.unansweredCount,
      score.earnedScore,
      score.maxScore,
      score.percentage,
      now,
      releasedAt,
    ],
  );
  const updated: RuntimeSession = {
    ...session,
    status: "SCORED",
    submittedAt: submittedAt ?? session.submittedAt,
    expiredAt: expiredAt ?? session.expiredAt,
    endedAt: endedAt ?? session.endedAt,
    scoredAt: now,
    finalizationReason: reason,
    finalizedByUserId: actorUserId ?? null,
    finalizationNote: note ?? null,
    lastSeenAt: now,
    version: session.version + 1,
    updatedAt: now,
  };
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
    releasedAt,
  };
  return { session: updated, result };
}

async function readResult(
  connection: DatabaseConnection,
  sessionId: Id,
): Promise<ExamResult | null> {
  const rows = await connection.query<Row>(
    "SELECT session_id, schedule_id, participant_id, correct_count, incorrect_count, unanswered_count, earned_score, max_score, percentage, scored_at, released_at FROM exam_results WHERE session_id = ? LIMIT 1",
    [sessionId],
  );
  if (!rows[0]) return null;
  return {
    sessionId: dbId(rows[0].session_id),
    scheduleId: dbId(rows[0].schedule_id),
    participantId:
      rows[0].participant_id == null ? null : dbId(rows[0].participant_id),
    correctCount: Number(rows[0].correct_count),
    incorrectCount: Number(rows[0].incorrect_count),
    unansweredCount: Number(rows[0].unanswered_count),
    earnedScore: String(rows[0].earned_score),
    maxScore: String(rows[0].max_score),
    percentage: String(rows[0].percentage),
    scoredAt: dbTimestamp(rows[0].scored_at),
    releasedAt: nullableTimestamp(rows[0].released_at),
  };
}

function mapGrant(row: Row): AttemptGrant {
  return {
    id: dbId(row.id),
    scheduleId: dbId(row.schedule_id),
    participantId: dbId(row.participant_id),
    sourceSessionId: dbId(row.source_session_id),
    grantedAttemptNo: Number(row.granted_attempt_no),
    reason: String(row.reason),
    grantedByUserId: dbId(row.granted_by_user_id),
    resetIdempotencyKey: String(row.reset_idempotency_key),
    consumedBySessionId:
      row.consumed_by_session_id == null
        ? null
        : dbId(row.consumed_by_session_id),
    createdAt: dbTimestamp(row.created_at),
    consumedAt: nullableTimestamp(row.consumed_at),
  };
}

function statusError(status: RuntimeSession["status"]): ExamSessionError {
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

function emptyResponse(
  source: RuntimeQuestionSource,
): import("../scoring").ScoringResponse {
  if (source.type === "SINGLE_CHOICE") return { selectedOptionId: null };
  if (source.type === "MULTIPLE_RESPONSE") return { selectedOptionIds: [] };
  return { statements: [] };
}

function safeView(
  session: RuntimeSession,
  manifest: readonly RuntimeQuestionManifest[],
  answers: readonly RuntimeAnswer[],
  serverNow: UtcTimestamp,
): ParticipantSessionView {
  const {
    randomSeed: _seed,
    finalizationNote: _note,
    practiceTokenHash: _token,
    practiceCredentialHash: _credential,
    ...safeSession
  } = session;
  return { session: safeSession, manifest, answers, serverNow };
}

function assertSessionAccess(
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

function assertAnswerItems(
  items: readonly (
    | import("./domain").SessionAnswerItem
    | import("./domain").FinalAnswerItem
  )[],
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

function assertFinalAnswerItems(
  items: readonly import("./domain").FinalAnswerItem[],
): void {
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

function mapSession(row: Row): RuntimeSession {
  const participantId =
    row.participant_id === null || row.participant_id === undefined
      ? null
      : dbId(row.participant_id);
  const token = bytes(row.practice_access_token_hash);
  const credential = bytes(row.practice_session_credential_hash);
  return {
    id: dbId(row.id),
    scheduleId: dbId(row.schedule_id),
    examRevisionId: dbId(row.exam_revision_id),
    participantId,
    attemptNo: Number(row.attempt_no),
    status: String(row.status) as RuntimeSession["status"],
    startedAt: dbTimestamp(row.started_at),
    deadlineAt: dbTimestamp(row.deadline_at),
    lastSeenAt: dbTimestamp(row.last_seen_at),
    submittedAt: nullableTimestamp(row.submitted_at),
    expiredAt: nullableTimestamp(row.expired_at),
    endedAt: nullableTimestamp(row.ended_at),
    scoredAt: nullableTimestamp(row.scored_at),
    finalizationReason: row.finalization_reason
      ? (String(
          row.finalization_reason,
        ) as RuntimeSession["finalizationReason"])
      : null,
    finalizedByUserId:
      row.finalized_by_user_id == null ? null : dbId(row.finalized_by_user_id),
    finalizationNote:
      row.finalization_note == null ? null : String(row.finalization_note),
    participantNameSnapshot: String(row.participant_name_snapshot),
    classSnapshot:
      row.class_snapshot == null ? null : String(row.class_snapshot),
    institutionSnapshot:
      row.institution_snapshot == null
        ? null
        : String(row.institution_snapshot),
    identityExtra: parseJson(row.identity_extra_json) as Readonly<
      Record<string, string>
    >,
    randomSeed: bytes(row.random_seed) ?? new Uint8Array(32),
    startIdempotencyKey: String(row.start_idempotency_key),
    practice: token !== undefined,
    ...(token ? { practiceTokenHash: token } : {}),
    ...(credential ? { practiceCredentialHash: credential } : {}),
    version: Number(row.version ?? 1),
    updatedAt: dbTimestamp(row.updated_at),
  };
}

function isOpen(schedule: RuntimeSchedule, now: UtcTimestamp): boolean {
  const current = Date.parse(now);
  return (
    (schedule.status === "OPEN" || schedule.status === "READY") &&
    current >= Date.parse(schedule.startsAt) &&
    current < Date.parse(schedule.endsAt)
  );
}
function unavailable(): ExamSessionError {
  return new ExamSessionError(
    "SCHEDULE_NOT_AVAILABLE",
    "Ujian belum tersedia.",
    409,
  );
}
function serverNow(): UtcTimestamp {
  return formatUtcTimestamp(new Date());
}
function dbId(value: unknown): Id {
  const parsed = parseId(String(value));
  if (!parsed) throw new Error("Database returned invalid ID");
  return parsed;
}
function dbTimestamp(value: unknown): UtcTimestamp {
  const parsed = parseUtcTimestamp(
    value instanceof Date
      ? value.toISOString()
      : String(value).replace(" ", "T") +
          (String(value).endsWith("Z") ? "" : "Z"),
  );
  if (!parsed) throw new Error("Database returned invalid timestamp");
  return parsed;
}
function nullableTimestamp(value: unknown): UtcTimestamp | null {
  return value == null ? null : dbTimestamp(value);
}
function bytes(value: unknown): Uint8Array | undefined {
  if (value == null) return undefined;
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (typeof value === "string")
    return new Uint8Array(Buffer.from(value, "binary"));
  return undefined;
}

function databaseBoolean(value: unknown): boolean {
  if (value === true || value === 1 || value === 1n || value === "1")
    return true;
  if (value === false || value === 0 || value === 0n || value === "0")
    return false;
  throw new Error("Database returned invalid boolean");
}

function parseJson(value: unknown): unknown {
  if (value == null || value === "") return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}
function parseJsonArray(value: unknown): Id[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed)
    ? parsed.filter((item): item is Id => typeof item === "string")
    : [];
}
function bytesEqual(left: Uint8Array, right: Uint8Array | undefined): boolean {
  if (!right || left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1)
    result |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return result === 0;
}
function deterministicShuffleDefinitions(
  values: readonly RuntimeQuestionDefinition[],
  seed: Uint8Array,
): RuntimeQuestionDefinition[] {
  const result = [...values];
  let state = seed.reduce((acc, value) => (acc ^ value) >>> 0, 0x9e3779b9);
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(next() * (index + 1));
    const left = result[index];
    const right = result[swap];
    if (left === undefined || right === undefined) continue;
    [result[index], result[swap]] = [right, left];
  }
  return result;
}
function deterministicShuffleIds(
  values: readonly Id[],
  seed: Uint8Array,
  offset: number,
): Id[] {
  const copy = new Uint8Array(seed);
  copy[0] = ((copy[0] ?? 0) ^ offset) & 0xff;
  return deterministicShuffleDefinitions(
    values.map((questionRevisionId) => ({
      questionRevisionId,
      points: "1.00",
    })),
    copy,
  ).map((item) => item.questionRevisionId);
}
