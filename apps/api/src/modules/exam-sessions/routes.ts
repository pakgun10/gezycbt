import type { Id } from "@gezycbt/contracts";
import { Elysia } from "elysia";
import type { UseCaseContext } from "../../application/actor-context";
import type { AppError } from "../../http/app-error";
import { normalizeScheduleAccessCode } from "../schedules/access-code";
import {
  ExamSessionError,
  type ParticipantScheduleSummary,
  participantStartResponse,
  participantSubmitResponse,
} from "./domain";
import { toParticipantRuntimeError } from "./error-contract";
import {
  digestPracticeCredential,
  readPracticeCredential,
} from "./practice-credential";
import type {
  ExamAnswerService,
  ExamSessionQueryService,
  ExamSessionStartService,
  ExamSubmissionService,
} from "./service";

export interface ExamSessionRoutesOptions {
  readonly startService: Pick<
    ExamSessionStartService,
    | "startMainWithEligibility"
    | "resolvePractice"
    | "startPracticeWithCredential"
  >;
  readonly answerService: Pick<ExamAnswerService, "save">;
  readonly queryService: Pick<
    ExamSessionQueryService,
    "getParticipantSession" | "getParticipantResult"
  >;
  readonly submissionService: Pick<ExamSubmissionService, "submit">;
  readonly participantContext: (
    request: Request,
    requestId: string,
  ) => Promise<UseCaseContext>;
  /** Loads authoritative profile/class snapshot for a logged-in participant. */
  readonly participantSnapshot: (participantId: Id) => Promise<{
    readonly participantName: string;
    readonly classSnapshot?: string | null;
    readonly institutionSnapshot?: string | null;
    readonly identityExtra?: Readonly<Record<string, string>>;
  }>;
  readonly participantClassIds?: (participantId: Id) => Promise<readonly Id[]>;
  /** Dashboard query kept outside the runtime store so it can use indexed SQL. */
  readonly participantSchedules?: (input: {
    readonly participantId: Id;
    readonly classIds: readonly Id[];
  }) => Promise<readonly ParticipantScheduleSummary[]>;
  readonly mainAccessCodeDigest: (code: string) => Promise<Uint8Array>;
  readonly practiceTokenDigest: (token: string) => Promise<Uint8Array>;
}

/** Participant runtime routes; authentication/session middleware is injected by the host. */
export function createExamSessionRoutes(options: ExamSessionRoutesOptions) {
  return new Elysia({ name: "gezycbt-exam-session-routes" })
    .get("/api/v1/participant/schedules", async ({ request }) => {
      try {
        const context = await options.participantContext(
          request,
          request.headers.get("x-request-id") ?? crypto.randomUUID(),
        );
        const participantId = context.actor.userId;
        if (
          context.actor.actorType !== "HUMAN" ||
          context.actor.role !== "PARTICIPANT" ||
          !participantId
        )
          throw new ExamSessionError(
            "AUTHENTICATION_REQUIRED",
            "Silakan masuk untuk melanjutkan.",
            401,
          );
        if (!options.participantSchedules)
          throw new ExamSessionError(
            "SERVICE_BUSY",
            "Dashboard ujian belum tersedia.",
            503,
          );
        const classIds = options.participantClassIds
          ? await options.participantClassIds(participantId)
          : [];
        const items = await options.participantSchedules({
          participantId,
          classIds,
        });
        if (items.length > 200)
          throw new ExamSessionError(
            "SERVICE_BUSY",
            "Dashboard memiliki terlalu banyak jadwal.",
            503,
          );
        return {
          data: {
            items,
          },
        };
      } catch (error) {
        throw mapError(error);
      }
    })
    .post(
      "/api/v1/participant/schedules/:id/sessions",
      async ({ params, body, request, set }) => {
        try {
          const payload = objectPayload(body);
          const context = await options.participantContext(
            request,
            request.headers.get("x-request-id") ?? crypto.randomUUID(),
          );
          const participantId = context.actor.userId;
          if (!participantId)
            throw new ExamSessionError(
              "AUTHENTICATION_REQUIRED",
              "Silakan masuk untuk melanjutkan.",
              401,
            );
          const snapshot = await options.participantSnapshot(participantId);
          const classIds = options.participantClassIds
            ? await options.participantClassIds(participantId)
            : [];
          const result = await options.startService.startMainWithEligibility(
            {
              ...context,
              idempotencyKey: headerOrBody(request, payload, "idempotency-key"),
            },
            {
              scheduleId: String((params as Record<string, unknown>).id) as Id,
              participantName: snapshot.participantName,
              ...(snapshot.classSnapshot === undefined
                ? {}
                : { classSnapshot: snapshot.classSnapshot }),
              ...(snapshot.institutionSnapshot === undefined
                ? {}
                : { institutionSnapshot: snapshot.institutionSnapshot }),
              ...(snapshot.identityExtra === undefined
                ? {}
                : { identityExtra: snapshot.identityExtra }),
              mainAccessCodeDigest: await options.mainAccessCodeDigest(
                normalizeCode(String(payload.mainAccessCode ?? "")),
              ),
              startIdempotencyKey: String(
                payload.startIdempotencyKey ??
                  headerOrBody(request, payload, "idempotency-key"),
              ),
            },
            classIds,
          );
          set.status = result.replayed ? 200 : 201;
          return { data: participantStartResponse(result) };
        } catch (error) {
          throw mapError(error);
        }
      },
    )
    .post("/api/v1/participant/practice/resolve", async ({ body }) => {
      const payload = objectPayload(body);
      try {
        return {
          data: await options.startService.resolvePractice({
            practiceTokenDigest: await options.practiceTokenDigest(
              normalizeCode(String(payload.token ?? "")),
            ),
          }),
        };
      } catch (error) {
        throw mapError(error);
      }
    })
    .post("/api/v1/participant/practice/sessions", async ({ body, set }) => {
      const payload = objectPayload(body);
      try {
        const token = String(payload.token ?? "");
        const identity = objectPayload(
          payload.identity,
          "Identity tidak valid.",
        );
        const classSnapshot = optionalText(identity.class);
        const institutionSnapshot = optionalText(identity.institution);
        const result = await options.startService.startPracticeWithCredential({
          scheduleId: String(payload.scheduleId) as Id,
          practiceTokenDigest: await options.practiceTokenDigest(
            normalizeCode(token),
          ),
          participantName: textValue(identity.name) ?? "",
          ...(classSnapshot === undefined ? {} : { classSnapshot }),
          ...(institutionSnapshot === undefined ? {} : { institutionSnapshot }),
          identityExtra: Object.fromEntries(
            Object.entries(identity)
              .filter(
                ([key]) => !["name", "class", "institution"].includes(key),
              )
              .map(([key, value]) => [key, textValue(value) ?? ""]),
          ),
          startIdempotencyKey: String(payload.startIdempotencyKey ?? ""),
        });
        set.status = result.replayed ? 200 : 201;
        if (result.practiceCredential) {
          set.headers["set-cookie"] = result.practiceCredential.cookie;
        }
        const { practiceCredential: _credential, ...startResult } = result;
        return { data: participantStartResponse(startResult) };
      } catch (error) {
        throw mapError(error);
      }
    })
    .get(
      "/api/v1/participant/exam-sessions/:id",
      async ({ params, request }) => {
        try {
          const raw = readPracticeCredential(request.headers.get("cookie"));
          const practiceCredential = raw
            ? await digestPracticeCredential(raw)
            : undefined;
          const context = await resolveParticipantContext(options, request);
          return {
            data: await options.queryService.getParticipantSession(
              { ...context },
              String((params as Record<string, unknown>).id) as Id,
              practiceCredential,
            ),
          };
        } catch (error) {
          throw mapError(error);
        }
      },
    )
    .post(
      "/api/v1/participant/exam-sessions/:id/answers",
      async ({ params, body, request }) => {
        try {
          const raw = readPracticeCredential(request.headers.get("cookie"));
          const practiceCredential = raw
            ? await digestPracticeCredential(raw)
            : undefined;
          const context = await resolveParticipantContext(options, request);
          const payload = objectPayload(body);
          const items = payload.items;
          if (!Array.isArray(items))
            throw new ExamSessionError(
              "INVALID_ANSWER_SHAPE",
              "Items jawaban harus berupa array.",
              422,
            );
          return {
            data: await options.answerService.save(
              {
                ...context,
                idempotencyKey:
                  request.headers.get("idempotency-key") ??
                  context.idempotencyKey ??
                  "",
              },
              String((params as Record<string, unknown>).id) as Id,
              items as readonly import("./domain").SessionAnswerItem[],
              undefined,
              practiceCredential,
            ),
          };
        } catch (error) {
          throw mapError(error);
        }
      },
    )
    .get(
      "/api/v1/participant/exam-sessions/:id/result",
      async ({ params, request }) => {
        try {
          const raw = readPracticeCredential(request.headers.get("cookie"));
          const practiceCredential = raw
            ? await digestPracticeCredential(raw)
            : undefined;
          const context = await resolveParticipantContext(options, request);
          return {
            data: await options.queryService.getParticipantResult(
              context,
              String((params as Record<string, unknown>).id) as Id,
              practiceCredential,
            ),
          };
        } catch (error) {
          throw mapError(error);
        }
      },
    )
    .post(
      "/api/v1/participant/exam-sessions/:id/submit",
      async ({ params, body, request }) => {
        try {
          const raw = readPracticeCredential(request.headers.get("cookie"));
          const practiceCredential = raw
            ? await digestPracticeCredential(raw)
            : undefined;
          const context = await resolveParticipantContext(options, request);
          const payload = objectPayload(body);
          const finalAnswers = payload.finalAnswers;
          if (!Array.isArray(finalAnswers))
            throw new ExamSessionError(
              "INVALID_ANSWER_SHAPE",
              "Final answers harus berupa array.",
              422,
            );
          const result = await options.submissionService.submit(
            {
              ...context,
              idempotencyKey:
                request.headers.get("idempotency-key") ??
                context.idempotencyKey ??
                "",
            },
            String((params as Record<string, unknown>).id) as Id,
            finalAnswers as readonly import("./domain").FinalAnswerItem[],
            undefined,
            practiceCredential,
          );
          return { data: participantSubmitResponse(result) };
        } catch (error) {
          throw mapError(error);
        }
      },
    );
}

function headerOrBody(
  request: Request,
  body: Record<string, unknown>,
  name: string,
): string {
  return request.headers.get(name) ?? String(body.startIdempotencyKey ?? "");
}

function optionalText(value: unknown): string | null | undefined {
  return value === undefined || value === null
    ? (value as undefined)
    : textValue(value);
}

function textValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string")
    throw new ExamSessionError(
      "INVALID_ANSWER_SHAPE",
      "Payload tidak valid.",
      422,
    );
  return value;
}

function objectPayload(
  value: unknown,
  message = "Payload tidak valid.",
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ExamSessionError("INVALID_ANSWER_SHAPE", message, 422);
  return value as Record<string, unknown>;
}

function normalizeCode(value: string): string {
  try {
    return normalizeScheduleAccessCode(value);
  } catch {
    // Hashing an impossible canonical value produces the same generic access
    // failure as an unknown code without revealing validation details.
    return "";
  }
}

async function resolveParticipantContext(
  options: ExamSessionRoutesOptions,
  request: Request,
): Promise<UseCaseContext> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    return await options.participantContext(request, requestId);
  } catch (error) {
    if (!readPracticeCredential(request.headers.get("cookie"))) throw error;
    return { actor: { actorType: "RECOVERY", requestId } };
  }
}

function mapError(error: unknown): AppError | unknown {
  return toParticipantRuntimeError(error) ?? error;
}
