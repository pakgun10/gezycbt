import { ApiClient, mutationHeaders } from "../../lib/api";
import type {
  AnswerItem,
  AnswerSaveResponse,
  FinalAnswer,
  LoginResponse,
  ParticipantResultResponse,
  ParticipantSchedule,
  ParticipantSessionView,
  PracticeResolveResponse,
  SessionStartResponse,
  SubmitResponse,
} from "./types";

export interface ParticipantApi {
  login(username: string, password: string): Promise<LoginResponse>;
  logout?(csrfToken?: string): Promise<void>;
  me(): Promise<LoginResponse>;
  schedules(): Promise<readonly ParticipantSchedule[]>;
  resolvePractice(token: string): Promise<PracticeResolveResponse["data"]>;
  startMain(
    scheduleId: string,
    startIdempotencyKey: string,
    mainAccessCode?: string,
  ): Promise<SessionStartResponse["data"]>;
  startPractice(
    scheduleId: string,
    token: string,
    identity: Readonly<Record<string, string>>,
    startIdempotencyKey: string,
  ): Promise<SessionStartResponse["data"]>;
  session(sessionId: string): Promise<ParticipantSessionView>;
  saveAnswers(
    sessionId: string,
    items: readonly AnswerItem[],
    csrfToken?: string,
  ): Promise<AnswerSaveResponse["data"]>;
  submit(
    sessionId: string,
    finalAnswers: readonly FinalAnswer[],
    idempotencyKey: string,
    csrfToken?: string,
  ): Promise<SubmitResponse["data"]>;
  result(sessionId: string): Promise<ParticipantResultResponse["data"]>;
}

export class HttpParticipantApi implements ParticipantApi {
  constructor(private readonly client = new ApiClient()) {}

  async login(username: string, password: string): Promise<LoginResponse> {
    const response = await this.client.request<LoginResponse>(
      "/api/v1/auth/participant/login",
      {
        method: "POST",
        body: { username, password },
      },
    );
    return response;
  }

  async logout(csrfToken?: string): Promise<void> {
    await this.client.request("/api/v1/auth/logout", {
      method: "POST",
      headers: mutationHeaders(crypto.randomUUID(), csrfToken),
    });
  }

  async me(): Promise<LoginResponse> {
    return this.client.request<LoginResponse>("/api/v1/auth/me", {
      method: "GET",
    });
  }

  async schedules(): Promise<readonly ParticipantSchedule[]> {
    const response = await this.client.request<{
      readonly data: { readonly items: readonly ParticipantSchedule[] };
    }>("/api/v1/participant/schedules", { method: "GET" });
    return response.data.items;
  }

  async resolvePractice(
    token: string,
  ): Promise<PracticeResolveResponse["data"]> {
    const response = await this.client.request<PracticeResolveResponse>(
      "/api/v1/participant/practice/resolve",
      { method: "POST", body: { token: normalizeToken(token) } },
    );
    return response.data;
  }

  async startMain(
    scheduleId: string,
    startIdempotencyKey: string,
    mainAccessCode?: string,
  ): Promise<SessionStartResponse["data"]> {
    const response = await this.client.request<SessionStartResponse>(
      `/api/v1/participant/schedules/${encodeURIComponent(scheduleId)}/sessions`,
      {
        method: "POST",
        headers: mutationHeaders(startIdempotencyKey),
        body: {
          startIdempotencyKey,
          ...(mainAccessCode
            ? { mainAccessCode: normalizeToken(mainAccessCode) }
            : {}),
        },
      },
    );
    return response.data;
  }

  async startPractice(
    scheduleId: string,
    token: string,
    identity: Readonly<Record<string, string>>,
    startIdempotencyKey: string,
  ): Promise<SessionStartResponse["data"]> {
    const response = await this.client.request<SessionStartResponse>(
      "/api/v1/participant/practice/sessions",
      {
        method: "POST",
        headers: mutationHeaders(startIdempotencyKey),
        body: {
          scheduleId,
          token: normalizeToken(token),
          identity,
          startIdempotencyKey,
        },
      },
    );
    return response.data;
  }

  async session(sessionId: string): Promise<ParticipantSessionView> {
    const response = await this.client.request<{
      readonly data: ParticipantSessionView;
    }>(`/api/v1/participant/exam-sessions/${encodeURIComponent(sessionId)}`, {
      method: "GET",
    });
    return response.data;
  }

  async saveAnswers(
    sessionId: string,
    items: readonly AnswerItem[],
    csrfToken?: string,
  ): Promise<AnswerSaveResponse["data"]> {
    const idempotencyKey = crypto.randomUUID();
    const response = await this.client.request<AnswerSaveResponse>(
      `/api/v1/participant/exam-sessions/${encodeURIComponent(sessionId)}/answers`,
      {
        method: "POST",
        headers: mutationHeaders(idempotencyKey, csrfToken),
        body: { items },
      },
    );
    return response.data;
  }

  async submit(
    sessionId: string,
    finalAnswers: readonly FinalAnswer[],
    idempotencyKey: string,
    csrfToken?: string,
  ): Promise<SubmitResponse["data"]> {
    const response = await this.client.request<SubmitResponse>(
      `/api/v1/participant/exam-sessions/${encodeURIComponent(sessionId)}/submit`,
      {
        method: "POST",
        headers: mutationHeaders(idempotencyKey, csrfToken),
        body: { finalAnswers },
      },
    );
    return response.data;
  }

  async result(sessionId: string): Promise<ParticipantResultResponse["data"]> {
    const response = await this.client.request<ParticipantResultResponse>(
      `/api/v1/participant/exam-sessions/${encodeURIComponent(sessionId)}/result`,
      { method: "GET" },
    );
    return response.data;
  }
}

export function normalizeToken(value: string): string {
  return value.replace(/-/gu, "").trim().toUpperCase();
}
