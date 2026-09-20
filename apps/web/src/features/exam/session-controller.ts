import { ApiClientError } from "../../lib/api";
import type { ParticipantApi } from "../participant/api";
import type {
  AnswerResponse,
  FinalAnswer,
  ParticipantSessionView,
  RuntimeAnswer,
  RuntimeQuestionManifest,
  RuntimeSession,
  SessionStartResponse,
} from "../participant/types";
import {
  type OutboxEntry,
  participantOutbox,
  type SessionSnapshot,
  snapshotFromSession,
} from "./outbox";

export type ExamSaveState =
  | "READY"
  | "DIRTY"
  | "SAVING"
  | "OFFLINE_DIRTY"
  | "CONFLICT"
  | "FINALIZING"
  | "ENDED";

export interface ExamSessionControllerOptions {
  readonly api: ParticipantApi;
  readonly storage?: typeof participantOutbox;
  readonly csrfToken?: string | undefined;
  readonly now?: () => number;
  readonly online?: () => boolean;
  readonly onAuthExpired?: (() => void) | undefined;
}

export interface SessionConflict {
  readonly sessionQuestionId: string;
  readonly serverVersion: number;
  readonly serverResponse: AnswerResponse;
  readonly localResponse: AnswerResponse;
}

export type ConflictResolution = "server" | "local";

/** Reliability state machine for the exam page. All local writes happen before navigation. */
export class ExamSessionController {
  readonly api: ParticipantApi;
  readonly storage: typeof participantOutbox;
  readonly now: () => number;
  readonly online: () => boolean;
  csrfToken: string | undefined;
  readonly onAuthExpired: (() => void) | undefined;
  session: RuntimeSession | null = null;
  manifest: readonly RuntimeQuestionManifest[] = [];
  answers = new Map<string, RuntimeAnswer>();
  state: ExamSaveState = "READY";
  conflicts: SessionConflict[] = [];
  serverOffsetMs = 0;
  private flushPromise: Promise<void> | null = null;
  private channel: BroadcastChannel | null = null;
  private readonly answerMutationQueues = new Map<string, Promise<void>>();

  constructor(options: ExamSessionControllerOptions) {
    this.api = options.api;
    this.storage = options.storage ?? participantOutbox;
    this.csrfToken = options.csrfToken;
    this.now = options.now ?? Date.now;
    this.online =
      options.online ??
      (() => typeof navigator === "undefined" || navigator.onLine);
    this.onAuthExpired = options.onAuthExpired;
  }

  get sessionId(): string | null {
    return this.session?.id ?? null;
  }

  get remainingSeconds(): number {
    if (!this.session) return 0;
    const serverNow = this.now() + this.serverOffsetMs;
    return Math.max(
      0,
      Math.ceil((Date.parse(this.session.deadlineAt) - serverNow) / 1000),
    );
  }

  get answeredCount(): number {
    return [...this.answers.values()].filter(
      (answer) => !isEmptyResponse(answer.response),
    ).length;
  }

  get pendingCount(): Promise<number> {
    return this.sessionId
      ? this.storage.listOutbox(this.sessionId).then((items) => items.length)
      : Promise.resolve(0);
  }

  async start(result: SessionStartResponse["data"]): Promise<void> {
    this.session = result.session;
    this.manifest = result.manifest;
    this.answers.clear();
    this.conflicts = [];
    this.serverOffsetMs = Date.parse(result.serverNow) - this.now();
    this.state = "READY";
    await this.persistSnapshot();
    this.setupChannel();
  }

  async resume(view: ParticipantSessionView): Promise<void> {
    this.session = view.session;
    this.manifest = view.manifest;
    this.answers = new Map(
      view.answers.map((answer) => [answer.sessionQuestionId, answer]),
    );
    this.serverOffsetMs = Date.parse(view.serverNow) - this.now();
    this.state = view.session.status === "ACTIVE" ? "READY" : "ENDED";
    this.conflicts = [];
    const pending = await this.storage.listOutbox(view.session.id);
    for (const item of pending)
      this.answers.set(item.sessionQuestionId, {
        sessionId: item.sessionId,
        sessionQuestionId: item.sessionQuestionId,
        response: item.response,
        version: item.baseVersion,
        answeredAt: new Date(item.queuedAt).toISOString(),
      });
    if (pending.length > 0)
      this.state = this.online() ? "DIRTY" : "OFFLINE_DIRTY";
    await this.persistSnapshot();
    this.setupChannel();
  }

  async restoreLocal(): Promise<boolean> {
    if (!this.sessionId) return false;
    const snapshot = await this.storage.getSnapshot(this.sessionId);
    if (!snapshot) return false;
    this.applySnapshot(snapshot);
    const pending = await this.storage.listOutbox(this.sessionId);
    for (const item of pending)
      this.answers.set(item.sessionQuestionId, {
        sessionId: item.sessionId,
        sessionQuestionId: item.sessionQuestionId,
        response: item.response,
        version: item.baseVersion,
        answeredAt: new Date(item.queuedAt).toISOString(),
      });
    if (pending.length > 0)
      this.state = this.online() ? "DIRTY" : "OFFLINE_DIRTY";
    return true;
  }

  async setAnswer(
    sessionQuestionId: string,
    response: AnswerResponse,
  ): Promise<void> {
    // A user can change an option again before the first IndexedDB write and
    // autosave finish. Serialize mutations for that question so two writes
    // never leave the server with the same baseVersion and create a false
    // conflict on the same browser.
    const previous =
      this.answerMutationQueues.get(sessionQuestionId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => this.applyAnswer(sessionQuestionId, response));
    this.answerMutationQueues.set(sessionQuestionId, next);
    try {
      await next;
    } finally {
      if (this.answerMutationQueues.get(sessionQuestionId) === next)
        this.answerMutationQueues.delete(sessionQuestionId);
    }
  }

  private async applyAnswer(
    sessionQuestionId: string,
    response: AnswerResponse,
  ): Promise<void> {
    const session = this.requireActive();
    const existing = this.answers.get(sessionQuestionId);
    const question = this.manifest.find(
      (item) => item.sessionQuestionId === sessionQuestionId,
    );
    if (
      question?.question.type === "TRUE_FALSE" &&
      "statements" in response &&
      response.statements.length > 0 &&
      response.statements.length < 3
    ) {
      this.answers.set(sessionQuestionId, {
        sessionId: session.id,
        sessionQuestionId,
        response,
        version: existing?.version ?? 0,
        answeredAt: new Date(this.now()).toISOString(),
      });
      await this.persistSnapshot();
      this.state = this.online() ? "DIRTY" : "OFFLINE_DIRTY";
      // If a previously committed response is made incomplete, explicitly
      // clear it on the server. A brand-new partial response remains local
      // until all three statements are answered or the participant submits.
      const pending = await this.storage.listOutbox(session.id);
      await Promise.all(
        pending
          .filter((item) => item.sessionQuestionId === sessionQuestionId)
          .map((item) => this.storage.deleteOutbox(item.id)),
      );
      if (existing && existing.version > 0) {
        await this.storage.putOutbox({
          id: crypto.randomUUID(),
          sessionId: session.id,
          sessionQuestionId,
          baseVersion: existing.version,
          response: { statements: [] },
          clientMutationId: crypto.randomUUID(),
          queuedAt: this.now(),
        });
        this.channel?.postMessage({
          type: "answer-changed",
          sessionId: session.id,
        });
      }
      return;
    }
    // Keep one pending mutation per question. Sending two entries with the
    // same baseVersion would intentionally create a conflict on the server;
    // the latest local value is the only value that still needs syncing.
    const existingPending = await this.storage.listOutbox(session.id);
    await Promise.all(
      existingPending
        .filter((item) => item.sessionQuestionId === sessionQuestionId)
        .map((item) => this.storage.deleteOutbox(item.id)),
    );
    const entry: OutboxEntry = {
      id: crypto.randomUUID(),
      sessionId: session.id,
      sessionQuestionId,
      baseVersion: existing?.version ?? 0,
      response,
      clientMutationId: crypto.randomUUID(),
      queuedAt: this.now(),
    };
    this.answers.set(sessionQuestionId, {
      sessionId: session.id,
      sessionQuestionId,
      response,
      version: entry.baseVersion,
      answeredAt: new Date(this.now()).toISOString(),
    });
    await this.storage.putOutbox(entry);
    await this.persistSnapshot();
    this.state = this.online() ? "DIRTY" : "OFFLINE_DIRTY";
    this.channel?.postMessage({
      type: "answer-changed",
      sessionId: session.id,
    });
  }

  async flush(): Promise<void> {
    if (this.flushPromise) return this.flushPromise;
    this.flushPromise = this.doFlush().finally(() => {
      this.flushPromise = null;
    });
    return this.flushPromise;
  }

  setCsrfToken(token: string | undefined): void {
    this.csrfToken = token;
  }

  /** Resolve one optimistic-lock conflict without discarding other answers. */
  async resolveConflict(
    sessionQuestionId: string,
    resolution: ConflictResolution,
  ): Promise<void> {
    const conflict = this.conflicts.find(
      (item) => item.sessionQuestionId === sessionQuestionId,
    );
    const session = this.requireSession();
    if (!conflict) return;
    const pending = await this.storage.listOutbox(session.id);
    await Promise.all(
      pending
        .filter((item) => item.sessionQuestionId === sessionQuestionId)
        .map((item) => this.storage.deleteOutbox(item.id)),
    );
    if (resolution === "server") {
      this.answers.set(sessionQuestionId, {
        sessionId: session.id,
        sessionQuestionId,
        response: conflict.serverResponse,
        version: conflict.serverVersion,
        answeredAt: new Date(this.now()).toISOString(),
      });
    } else {
      this.answers.set(sessionQuestionId, {
        sessionId: session.id,
        sessionQuestionId,
        response: conflict.localResponse,
        version: conflict.serverVersion,
        answeredAt: new Date(this.now()).toISOString(),
      });
      await this.storage.putOutbox({
        id: crypto.randomUUID(),
        sessionId: session.id,
        sessionQuestionId,
        baseVersion: conflict.serverVersion,
        response: conflict.localResponse,
        clientMutationId: crypto.randomUUID(),
        queuedAt: this.now(),
      });
    }
    this.conflicts = this.conflicts.filter(
      (item) => item.sessionQuestionId !== sessionQuestionId,
    );
    this.state =
      this.conflicts.length > 0
        ? "CONFLICT"
        : resolution === "local"
          ? "DIRTY"
          : "READY";
    await this.persistSnapshot();
  }

  clearConflicts(): void {
    this.conflicts = [];
    if (this.state === "CONFLICT") this.state = "READY";
  }

  async submit(idempotencyKey: string = crypto.randomUUID()): Promise<unknown> {
    const session = this.requireActive();
    this.state = "FINALIZING";
    const pending = await this.storage.listOutbox(session.id);
    const finalAnswers: FinalAnswer[] = mergeFinalAnswers(
      this.answers,
      pending,
    );
    try {
      const result = await this.api.submit(
        session.id,
        finalAnswers,
        idempotencyKey,
        this.csrfToken,
      );
      this.session = result.session;
      this.serverOffsetMs = Date.parse(result.serverNow) - this.now();
      this.answers.clear();
      await this.storage.clearOutbox(session.id);
      await this.persistSnapshot();
      this.state = "ENDED";
      this.channel?.postMessage({
        type: "session-finalized",
        sessionId: session.id,
      });
      return result;
    } catch (error) {
      this.handleError(error);
      if (
        error instanceof ApiClientError &&
        error.status === 409 &&
        ["SESSION_EXPIRED", "SESSION_ENDED", "SESSION_SUBMITTED"].includes(
          error.code,
        )
      ) {
        await this.storage.clearOutbox(session.id);
        await this.persistSnapshot();
      }
      throw error;
    }
  }

  async reloadFromServer(): Promise<void> {
    const session = this.requireSession();
    try {
      await this.resume(await this.api.session(session.id));
    } catch (error) {
      this.handleError(error);
      if (
        error instanceof ApiClientError &&
        error.status === 409 &&
        ["SESSION_EXPIRED", "SESSION_ENDED", "SESSION_SUBMITTED"].includes(
          error.code,
        )
      ) {
        await this.storage.clearOutbox(session.id);
        await this.persistSnapshot();
      }
      throw error;
    }
  }

  announceOnline(): Promise<void> {
    return this.flush();
  }

  dispose(): void {
    this.channel?.close();
    this.channel = null;
  }

  private async doFlush(): Promise<void> {
    const session = this.requireActive();
    if (!this.online()) {
      this.state = "OFFLINE_DIRTY";
      return;
    }
    const pending = await this.storage.listOutbox(session.id);
    if (pending.length === 0) {
      this.state = "READY";
      return;
    }
    this.state = "SAVING";
    try {
      for (let offset = 0; offset < pending.length; offset += 20) {
        const batch = pending.slice(offset, offset + 20);
        const saved = await this.api.saveAnswers(
          session.id,
          batch,
          this.csrfToken,
        );
        for (const outcome of saved.outcomes) {
          const queued = batch.find(
            (item) => item.sessionQuestionId === outcome.sessionQuestionId,
          );
          if (!queued) continue;
          if (outcome.status === "CONFLICT") {
            this.conflicts = this.conflicts.filter(
              (item) => item.sessionQuestionId !== outcome.sessionQuestionId,
            );
            this.conflicts.push({
              sessionQuestionId: outcome.sessionQuestionId,
              serverVersion: outcome.version,
              serverResponse: outcome.response ?? emptyResponse(),
              localResponse: queued.response,
            });
            continue;
          }
          const current = this.answers.get(queued.sessionQuestionId);
          await this.storage.deleteOutbox(queued.id);
          if (
            current &&
            JSON.stringify(current.response) !== JSON.stringify(queued.response)
          )
            continue;
          this.answers.set(queued.sessionQuestionId, {
            sessionId: session.id,
            sessionQuestionId: queued.sessionQuestionId,
            response: queued.response,
            version: outcome.version,
            answeredAt: saved.serverNow,
          });
        }
        this.session = { ...session, lastSeenAt: saved.serverNow };
      }
      const remaining = await this.storage.listOutbox(session.id);
      this.state =
        this.conflicts.length > 0
          ? "CONFLICT"
          : remaining.length > 0
            ? "DIRTY"
            : "READY";
      await this.persistSnapshot();
    } catch (error) {
      this.handleError(error);
      if (
        error instanceof ApiClientError &&
        error.status === 409 &&
        ["SESSION_EXPIRED", "SESSION_ENDED", "SESSION_SUBMITTED"].includes(
          error.code,
        )
      ) {
        await this.storage.clearOutbox(session.id);
        await this.persistSnapshot();
      }
      throw error;
    }
  }

  private handleError(error: unknown): void {
    if (error instanceof ApiClientError && error.status === 401) {
      this.state = "DIRTY";
      this.onAuthExpired?.();
      return;
    }
    if (error instanceof ApiClientError && error.status === 409) {
      if (
        error.code === "SESSION_ENDED" ||
        error.code === "SESSION_EXPIRED" ||
        error.code === "SESSION_SUBMITTED"
      )
        this.state = "ENDED";
      else this.state = "CONFLICT";
      return;
    }
    if (
      error instanceof ApiClientError &&
      (error.status === 429 || error.status === 503)
    ) {
      this.state = "DIRTY";
      return;
    }
    if (!this.online()) this.state = "OFFLINE_DIRTY";
    else this.state = "DIRTY";
  }

  private async persistSnapshot(): Promise<void> {
    const session = this.session;
    if (!session) return;
    await this.storage.putSnapshot(
      snapshotFromSession(
        {
          session,
          manifest: this.manifest,
          answers: [...this.answers.values()],
          serverNow: new Date(this.now() + this.serverOffsetMs).toISOString(),
        },
        this.serverOffsetMs,
      ),
    );
  }

  private applySnapshot(snapshot: SessionSnapshot): void {
    this.session = snapshot.session;
    this.manifest = snapshot.manifest;
    this.answers = new Map(
      snapshot.answers.map((answer) => [answer.sessionQuestionId, answer]),
    );
    this.serverOffsetMs = snapshot.serverOffsetMs;
  }

  private setupChannel(): void {
    if (typeof BroadcastChannel === "undefined" || !this.session) return;
    this.channel?.close();
    this.channel = new BroadcastChannel(`gezycbt-exam-${this.session.id}`);
    this.channel.onmessage = (event) => {
      if (event.data?.type === "session-finalized") this.state = "ENDED";
      if (event.data?.type === "answer-changed" && this.state === "READY")
        this.state = "CONFLICT";
    };
  }

  private requireSession(): RuntimeSession {
    if (!this.session) throw new Error("Exam session has not been loaded");
    return this.session;
  }

  private requireActive(): RuntimeSession {
    const session = this.requireSession();
    if (session.status !== "ACTIVE") {
      this.state = "ENDED";
      throw new Error("Exam session is no longer active");
    }
    return session;
  }
}

function mergeFinalAnswers(
  answers: ReadonlyMap<string, RuntimeAnswer>,
  pending: readonly OutboxEntry[],
): FinalAnswer[] {
  const latest = new Map<string, OutboxEntry>();
  for (const item of pending) latest.set(item.sessionQuestionId, item);
  return [...answers.entries()].map(([sessionQuestionId, answer]) => {
    const queued = latest.get(sessionQuestionId);
    const response = queued?.response ?? answer.response;
    return {
      sessionQuestionId,
      baseVersion: queued?.baseVersion ?? answer.version,
      response:
        "statements" in response &&
        response.statements.length > 0 &&
        response.statements.length < 3
          ? { statements: [] }
          : response,
    };
  });
}

function emptyResponse(): AnswerResponse {
  return { selectedOptionId: null };
}

function isEmptyResponse(response: AnswerResponse): boolean {
  if ("selectedOptionId" in response) return response.selectedOptionId === null;
  if ("selectedOptionIds" in response)
    return response.selectedOptionIds.length === 0;
  return response.statements.length !== 3;
}
