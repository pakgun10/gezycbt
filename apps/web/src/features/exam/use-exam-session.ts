import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { ApiClientError } from "../../lib/api";
import type { ParticipantApi } from "../participant/api";
import type {
  AnswerResponse,
  ParticipantSessionView,
  SessionStartResponse,
} from "../participant/types";
import {
  type ExamSaveState,
  ExamSessionController,
} from "./session-controller";

export function useExamSession(
  api: ParticipantApi,
  options: {
    readonly csrfToken?: string;
    readonly onAuthExpired?: () => void;
  } = {},
) {
  const controller = new ExamSessionController({
    api,
    ...(options.csrfToken === undefined
      ? {}
      : { csrfToken: options.csrfToken }),
    ...(options.onAuthExpired === undefined
      ? {}
      : { onAuthExpired: options.onAuthExpired }),
  });
  const session = ref(controller.session);
  const manifest = ref(controller.manifest);
  const answers = ref(controller.answers);
  const state = ref<ExamSaveState>(controller.state);
  const remainingSeconds = ref(controller.remainingSeconds);
  const conflicts = ref(controller.conflicts);
  let timer: number | undefined;
  let autosaveTimer: number | undefined;
  let retryTimer: number | undefined;
  let retryAttempt = 0;

  function sync(): void {
    session.value = controller.session;
    manifest.value = controller.manifest;
    // ExamSessionController mutates its internal Map in place. Expose a new
    // reference on every sync so Vue recomputes answered counts and response
    // bindings after a local answer or server acknowledgement.
    answers.value = new Map(controller.answers);
    state.value = controller.state;
    remainingSeconds.value = controller.remainingSeconds;
    conflicts.value = controller.conflicts;
  }

  async function start(result: SessionStartResponse["data"]): Promise<void> {
    await controller.start(result);
    sync();
  }

  async function resume(view: ParticipantSessionView): Promise<void> {
    await controller.resume(view);
    sync();
  }

  async function setAnswer(
    sessionQuestionId: string,
    response: AnswerResponse,
  ): Promise<void> {
    await controller.setAnswer(sessionQuestionId, response);
    sync();
    scheduleAutosave();
  }

  async function flush(): Promise<void> {
    try {
      await controller.flush();
      retryAttempt = 0;
    } catch (error) {
      if (
        !(error instanceof ApiClientError) ||
        error.status === 503 ||
        error.status === 429
      )
        scheduleRetry(
          error instanceof ApiClientError ? error.retryAfterSeconds : undefined,
        );
      throw error;
    } finally {
      sync();
    }
  }

  async function submit(idempotencyKey?: string): Promise<unknown> {
    try {
      return await controller.submit(idempotencyKey);
    } finally {
      sync();
    }
  }

  async function refresh(): Promise<void> {
    await controller.reloadFromServer();
    sync();
  }

  async function resolveConflict(
    sessionQuestionId: string,
    resolution: "server" | "local",
  ): Promise<void> {
    await controller.resolveConflict(sessionQuestionId, resolution);
    sync();
  }

  function setCsrfToken(token: string | undefined): void {
    controller.setCsrfToken(token);
  }

  function handleOnline(): void {
    void flush().catch(() => undefined);
  }

  onMounted(() => {
    timer = window.setInterval(() => {
      remainingSeconds.value = controller.remainingSeconds;
      if (
        controller.session &&
        remainingSeconds.value === 0 &&
        controller.state === "READY"
      )
        void flush().catch(() => undefined);
    }, 1000);
    window.addEventListener("online", handleOnline);
  });
  onBeforeUnmount(() => {
    if (timer !== undefined) window.clearInterval(timer);
    if (autosaveTimer !== undefined) window.clearTimeout(autosaveTimer);
    if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    window.removeEventListener("online", handleOnline);
    controller.dispose();
  });

  function scheduleAutosave(): void {
    if (autosaveTimer !== undefined) window.clearTimeout(autosaveTimer);
    const jitterMs = 250 + Math.floor(Math.random() * 750);
    autosaveTimer = window.setTimeout(() => {
      autosaveTimer = undefined;
      void flush().catch(() => undefined);
    }, 500 + jitterMs);
  }

  function scheduleRetry(serverDelaySeconds?: number): void {
    if (retryTimer !== undefined) return;
    const exponential = Math.min(30_000, 1_000 * 2 ** retryAttempt);
    retryAttempt = Math.min(retryAttempt + 1, 5);
    const hinted =
      serverDelaySeconds === undefined
        ? exponential
        : Math.max(1_000, serverDelaySeconds * 1_000);
    const jitterMs = Math.floor(Math.random() * 500);
    retryTimer = window.setTimeout(
      () => {
        retryTimer = undefined;
        void flush().catch(() => undefined);
      },
      Math.min(30_000, hinted + jitterMs),
    );
  }

  return {
    controller,
    session: computed(() => session.value),
    manifest: computed(() => manifest.value),
    answers: computed(() => answers.value),
    state: computed(() => state.value),
    remainingSeconds: computed(() => remainingSeconds.value),
    conflicts: computed(() => conflicts.value),
    start,
    resume,
    setAnswer,
    flush,
    submit,
    refresh,
    resolveConflict,
    setCsrfToken,
  };
}
