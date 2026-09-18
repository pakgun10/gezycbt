import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import type { DatabasePort } from "@gezycbt/database";
import { Elysia } from "elysia";
import {
  AuthorizationDeniedError,
  AuthorizationRequiredError,
} from "../../application/authorization";
import { AppError } from "../../http/app-error";
import { DiskProtectionError } from "../../observability/disk-guard";
import {
  assertCsrfRequest,
  CSRF_HEADER_NAME,
  CsrfProtectionError,
} from "../auth/csrf";
import { type AuthSessionService, readAuthCookie } from "../auth/session";
import {
  ExamImmutableError,
  ExamNotFoundError,
  ExamPublishInvariantError,
  ExamQuestionDuplicateError,
  ExamQuestionNotFoundError,
  ExamQuestionOrderError,
  ExamRevisionNotFoundError,
  ExamValidationError,
  ExamVersionConflictError,
} from "../exams/domain";
import { ExamPublishBlockedError } from "../exams/publish";
import {
  EXPORT_COLUMNS,
  EXPORT_FORMATS,
  ExportActiveError,
  type ExportColumn,
  ExportDownloadTokenError,
  type ExportFormat,
  ExportIdempotencyConflictError,
  ExportIdempotencyInProgressError,
  ExportNotFoundError,
  ExportNotReadyError,
  ExportValidationError,
} from "../exports/service";
import { MediaPersistenceError, MediaValidationError } from "../media/domain";
import {
  MEDIA_USAGES,
  MediaAssetReferencedError,
  MediaPublishedReferenceError,
  MediaRelationConflictError,
  MediaRelationImmutableError,
  MediaRelationNotFoundError,
  MediaRelationValidationError,
  type MediaUsage,
} from "../media/relation-domain";
import {
  QuestionForeignReferenceError,
  QuestionImmutableError,
  QuestionNotFoundError,
  QuestionValidationError,
  QuestionVersionConflictError,
} from "../questions/domain";
import { QuestionPublishBlockedError } from "../questions/publish";
import type { StoredUser } from "../users";
import {
  AGENT_ACTION_OPERATIONS,
  AGENT_ACTION_STATUSES,
  AGENT_ACTION_TARGET_TYPES,
  AgentActionApprovalRequiredError,
  AgentActionConflictError,
  AgentActionExecutionError,
  AgentActionExpiredError,
  AgentActionGrantChangedError,
  AgentActionNotFoundError,
  type AgentActionOperation,
  AgentActionPlanMismatchError,
  type AgentActionStatus,
  AgentActionValidationError,
  type IntegrationActionService,
} from "./action-service";
import {
  AgentExamNotFoundError,
  type IntegrationExamAuthoringService,
} from "./exam-authoring";
import {
  type AgentExportInput,
  AgentExportNotFoundError,
  AgentExportPiiDeniedError,
  type IntegrationExportService,
} from "./export-service";
import {
  type DiscoveryQuery,
  type DiscoveryResourceType,
  INTEGRATION_CLIENT_STATUSES,
  INTEGRATION_SCOPE_TYPES,
  IntegrationAuthenticationError,
  IntegrationCapabilityError,
  type IntegrationClientStatus,
  IntegrationConflictError,
  IntegrationNotFoundError,
  IntegrationRateLimitError,
  IntegrationScopeError,
  type IntegrationService,
  IntegrationValidationError,
} from "./index";
import {
  AgentQuestionNotFoundError,
  type IntegrationQuestionAuthoringService,
} from "./question-authoring";
import {
  AgentResultNotFoundError,
  type IntegrationResultReadService,
} from "./result-reads";

export interface IntegrationRouteOptions {
  readonly database: DatabasePort;
  readonly service: IntegrationService;
  readonly users: { readonly findById: (id: Id) => Promise<StoredUser | null> };
  readonly sessionService: Pick<
    AuthSessionService,
    "resolve" | "verifyCsrfSecret"
  >;
  readonly isReauthenticated: (userId: Id) => boolean;
  readonly expectedOrigin: URL | string;
  readonly questionAuthoring?: IntegrationQuestionAuthoringService;
  readonly examAuthoring?: IntegrationExamAuthoringService;
  readonly resultReads?: IntegrationResultReadService;
  readonly exports?: IntegrationExportService;
  readonly actions?: IntegrationActionService;
}

export function createIntegrationRoutes(
  options: IntegrationRouteOptions,
): Elysia {
  const app = new Elysia({ name: "gezycbt-integration-routes" });

  app.get("/api/v1/integrations/agent/me", async ({ request }) => {
    try {
      const authentication = await requireAgent(request, options, "read");
      const capabilities =
        await options.service.effectiveCapabilities(authentication);
      return {
        data: {
          client: {
            id: authentication.client.id,
            name: authentication.client.name,
            platformHint: authentication.client.platformHint,
            status: authentication.client.status,
          },
          owner: {
            id: authentication.client.ownerUserId,
            displayName: authentication.client.ownerDisplayName,
            role: authentication.client.ownerRole,
          },
          grantVersion: authentication.client.policyVersion,
          capabilities: capabilities.map((item) => item.capability),
        },
      };
    } catch (error) {
      throw mapIntegrationError(error);
    }
  });

  app.get("/api/v1/integrations/agent/capabilities", async ({ request }) => {
    try {
      const authentication = await requireAgent(request, options, "read");
      const capabilities =
        await options.service.effectiveCapabilities(authentication);
      return {
        data: {
          grantVersion: authentication.client.policyVersion,
          items: capabilities,
        },
      };
    } catch (error) {
      throw mapIntegrationError(error);
    }
  });

  app.get("/api/v1/integrations/agent/subjects", async ({ request, query }) => {
    try {
      const requestId = requestIdOf(request);
      const authentication = await requireAgent(request, options, "read");
      return {
        data: await options.service.searchSubjects(
          authentication,
          parseDiscoveryQuery(query, "subjects"),
          requestId,
        ),
      };
    } catch (error) {
      throw mapIntegrationError(error);
    }
  });

  app.get("/api/v1/integrations/agent/classes", async ({ request, query }) => {
    try {
      const requestId = requestIdOf(request);
      const authentication = await requireAgent(request, options, "read");
      return {
        data: await options.service.searchClasses(
          authentication,
          parseDiscoveryQuery(query, "classes"),
          requestId,
        ),
      };
    } catch (error) {
      throw mapIntegrationError(error);
    }
  });

  app.get(
    "/api/v1/integrations/agent/question-banks",
    async ({ request, query }) => {
      try {
        const requestId = requestIdOf(request);
        const authentication = await requireAgent(request, options, "read");
        return {
          data: await options.service.searchQuestionBanks(
            authentication,
            parseDiscoveryQuery(query, "question_banks"),
            requestId,
          ),
        };
      } catch (error) {
        throw mapIntegrationError(error);
      }
    },
  );

  app.get(
    "/api/v1/integrations/agent/questions",
    async ({ request, query }) => {
      try {
        const requestId = requestIdOf(request);
        const authentication = await requireAgent(request, options, "read");
        return {
          data: await options.service.searchQuestions(
            authentication,
            parseDiscoveryQuery(query, "questions"),
            requestId,
          ),
        };
      } catch (error) {
        throw mapIntegrationError(error);
      }
    },
  );

  app.get(
    "/api/v1/integrations/agent/questions/:id",
    async ({ request, params, query }) => {
      try {
        const authoring = requireQuestionAuthoring(options);
        const requestId = requestIdOf(request);
        const authentication = await requireAgent(request, options, "read");
        const queryPayload =
          query && typeof query === "object" && !Array.isArray(query)
            ? (query as Record<string, unknown>)
            : {};
        const includeKey = queryBoolean(queryPayload.includeKey, "includeKey");
        return {
          data: await authoring.getQuestion(
            authentication,
            idParam(params),
            includeKey,
            requestId,
          ),
        };
      } catch (error) {
        throw mapIntegrationError(error);
      }
    },
  );

  app.post("/api/v1/integrations/agent/questions", async ({ request, body }) =>
    agentMutation(request, options, async (authentication, requestId, key) => {
      const authoring = requireQuestionAuthoring(options);
      const payload = objectPayload(body);
      return authoring.createQuestion(
        authentication,
        {
          questionBankId: idValue(payload.questionBankId, "questionBankId"),
          ...questionContentPayload(payload),
        },
        requestId,
        key,
      );
    }),
  );

  app.post(
    "/api/v1/integrations/agent/questions/:id/revisions",
    async ({ request, params, body }) =>
      agentMutation(
        request,
        options,
        async (authentication, requestId, key) => {
          const authoring = requireQuestionAuthoring(options);
          const payload = objectPayload(body);
          return authoring.createRevision(
            authentication,
            idParam(params),
            questionContentPayload(payload),
            requiredTimestamp(payload.expectedUpdatedAt, "expectedUpdatedAt"),
            requestId,
            key,
          );
        },
      ),
  );

  app.patch(
    "/api/v1/integrations/agent/question-revisions/:id",
    async ({ request, params, body }) =>
      agentMutation(
        request,
        options,
        async (authentication, requestId, key) => {
          const authoring = requireQuestionAuthoring(options);
          const payload = objectPayload(body);
          return authoring.updateQuestion(
            authentication,
            idParam(params),
            questionContentPayload(payload),
            requiredTimestamp(payload.expectedUpdatedAt, "expectedUpdatedAt"),
            requestId,
            key,
          );
        },
      ),
  );

  app.post(
    "/api/v1/integrations/agent/question-revisions/:id/validate",
    async ({ request, params }) => {
      try {
        const authoring = requireQuestionAuthoring(options);
        const requestId = requestIdOf(request);
        const authentication = await requireAgent(request, options, "read");
        return {
          data: await authoring.validateQuestion(
            authentication,
            idParam(params),
            requestId,
          ),
        };
      } catch (error) {
        throw mapIntegrationError(error);
      }
    },
  );

  app.post(
    "/api/v1/integrations/agent/question-revisions/:id/publish",
    async ({ request, params, body }) =>
      agentMutation(
        request,
        options,
        async (authentication, requestId, key) => {
          const authoring = requireQuestionAuthoring(options);
          const payload = objectPayload(body);
          return authoring.publishQuestion(
            authentication,
            idParam(params),
            requiredTimestamp(payload.expectedUpdatedAt, "expectedUpdatedAt"),
            requestId,
            key,
          );
        },
      ),
  );

  app.post("/api/v1/integrations/agent/media", async ({ request }) => {
    try {
      const authoring = requireQuestionAuthoring(options);
      const requestId = requestIdOf(request);
      const authentication = await requireAgent(request, options, "mutation");
      const key = requiredAgentIdempotencyKey(request);
      const contentLength = request.headers.get("content-length");
      if (contentLength !== null) {
        const bytes = Number(contentLength);
        if (!Number.isSafeInteger(bytes) || bytes > 3 * 1024 * 1024)
          throw new AppError(
            422,
            "VALIDATION_FAILED",
            "Upload media melebihi batas request.",
          );
      }
      const form = await request.formData();
      const candidate = form.get("file");
      if (!candidate || typeof candidate === "string")
        throw new AppError(422, "VALIDATION_FAILED", "File media wajib diisi.");
      const arrayBuffer = await candidate.arrayBuffer();
      const originalName =
        optionalString(form.get("originalName")) ?? candidate.name;
      if (!originalName)
        throw new AppError(422, "VALIDATION_FAILED", "Nama file wajib diisi.");
      const result = await authoring.uploadMedia(
        authentication,
        {
          bytes: new Uint8Array(arrayBuffer),
          originalName,
          ...(candidate.type ? { claimedMimeType: candidate.type } : {}),
        },
        requestId,
        key,
      );
      return { data: result };
    } catch (error) {
      throw mapIntegrationError(error);
    }
  });

  app.post(
    "/api/v1/integrations/agent/question-revisions/:id/media",
    async ({ request, params, body }) =>
      agentMutation(
        request,
        options,
        async (authentication, requestId, key) => {
          const authoring = requireQuestionAuthoring(options);
          const payload = objectPayload(body);
          const usage = stringField(payload.usage, "usage");
          if (!MEDIA_USAGES.includes(usage as MediaUsage))
            throw new AppError(422, "VALIDATION_FAILED", "usage tidak valid.");
          const isDecorative = payload.isDecorative;
          if (typeof isDecorative !== "boolean")
            throw new AppError(
              422,
              "VALIDATION_FAILED",
              "isDecorative wajib berupa boolean.",
            );
          const altText =
            payload.altText === null || payload.altText === undefined
              ? null
              : stringField(payload.altText, "altText");
          return authoring.attachMedia(
            authentication,
            {
              questionRevisionId: idParam(params),
              mediaAssetId: idValue(payload.mediaAssetId, "mediaAssetId"),
              usage: usage as MediaUsage,
              altText,
              isDecorative,
            },
            requestId,
            key,
          );
        },
      ),
  );

  app.get("/api/v1/integrations/agent/exams", async ({ request, query }) => {
    try {
      const requestId = requestIdOf(request);
      const authentication = await requireAgent(request, options, "read");
      return {
        data: await options.service.searchExams(
          authentication,
          parseDiscoveryQuery(query, "exams"),
          requestId,
        ),
      };
    } catch (error) {
      throw mapIntegrationError(error);
    }
  });

  app.get(
    "/api/v1/integrations/agent/exams/:id",
    async ({ request, params }) => {
      try {
        const authoring = requireExamAuthoring(options);
        const requestId = requestIdOf(request);
        const authentication = await requireAgent(request, options, "read");
        return {
          data: await authoring.getExam(
            authentication,
            idParam(params),
            requestId,
          ),
        };
      } catch (error) {
        throw mapIntegrationError(error);
      }
    },
  );

  app.post("/api/v1/integrations/agent/exams", async ({ request, body }) =>
    agentMutation(request, options, async (authentication, requestId, key) => {
      const authoring = requireExamAuthoring(options);
      const payload = objectPayload(body);
      return authoring.createExam(
        authentication,
        {
          subjectId: idValue(payload.subjectId, "subjectId"),
          ...(payload.ownerTeacherId === undefined
            ? {}
            : {
                ownerTeacherId: idValue(
                  payload.ownerTeacherId,
                  "ownerTeacherId",
                ),
              }),
          ...examMetadataPayload(payload),
        },
        requestId,
        key,
      );
    }),
  );

  app.post(
    "/api/v1/integrations/agent/exams/:id/revisions",
    async ({ request, params, body }) =>
      agentMutation(
        request,
        options,
        async (authentication, requestId, key) => {
          const authoring = requireExamAuthoring(options);
          return authoring.createRevision(
            authentication,
            idParam(params),
            examMetadataPayload(objectPayload(body)),
            requestId,
            key,
          );
        },
      ),
  );

  app.patch(
    "/api/v1/integrations/agent/exam-revisions/:id",
    async ({ request, params, body }) =>
      agentMutation(
        request,
        options,
        async (authentication, requestId, key) => {
          const authoring = requireExamAuthoring(options);
          const payload = objectPayload(body);
          const expected = requiredTimestamp(
            payload.expectedUpdatedAt,
            "expectedUpdatedAt",
          );
          const { expectedUpdatedAt: _expected, ...input } = payload;
          return authoring.updateRevision(
            authentication,
            idParam(params),
            examMetadataPatchPayload(input),
            expected,
            requestId,
            key,
          );
        },
      ),
  );

  app.post(
    "/api/v1/integrations/agent/exam-revisions/:id/questions",
    async ({ request, params, body }) =>
      agentMutation(
        request,
        options,
        async (authentication, requestId, key) => {
          const authoring = requireExamAuthoring(options);
          const payload = objectPayload(body);
          return authoring.addQuestion(
            authentication,
            idParam(params),
            {
              questionRevisionId: idValue(
                payload.questionRevisionId,
                "questionRevisionId",
              ),
              points: stringField(payload.points, "points"),
              ...(payload.position === undefined
                ? {}
                : { position: requiredInteger(payload.position, "position") }),
            },
            requiredTimestamp(payload.expectedUpdatedAt, "expectedUpdatedAt"),
            requestId,
            key,
          );
        },
      ),
  );

  app.delete(
    "/api/v1/integrations/agent/exam-revisions/:id/questions/:questionId",
    async ({ request, params, body }) =>
      agentMutation(
        request,
        options,
        async (authentication, requestId, key) => {
          const authoring = requireExamAuthoring(options);
          const payload = objectPayload(body);
          return authoring.removeQuestion(
            authentication,
            idParam(params),
            idValue(
              (params as Record<string, unknown>).questionId,
              "questionId",
            ),
            requiredTimestamp(payload.expectedUpdatedAt, "expectedUpdatedAt"),
            requestId,
            key,
          );
        },
      ),
  );

  app.put(
    "/api/v1/integrations/agent/exam-revisions/:id/questions/order",
    async ({ request, params, body }) =>
      agentMutation(
        request,
        options,
        async (authentication, requestId, key) => {
          const authoring = requireExamAuthoring(options);
          const payload = objectPayload(body);
          if (!Array.isArray(payload.questionRevisionIds))
            throw new AppError(
              422,
              "VALIDATION_FAILED",
              "questionRevisionIds harus berupa array.",
            );
          return authoring.reorderQuestions(
            authentication,
            idParam(params),
            payload.questionRevisionIds.map((id) =>
              idValue(id, "questionRevisionId"),
            ),
            requiredTimestamp(payload.expectedUpdatedAt, "expectedUpdatedAt"),
            requestId,
            key,
          );
        },
      ),
  );

  app.post(
    "/api/v1/integrations/agent/exam-revisions/:id/validate",
    async ({ request, params }) => {
      try {
        const authoring = requireExamAuthoring(options);
        const requestId = requestIdOf(request);
        const authentication = await requireAgent(request, options, "read");
        return {
          data: await authoring.validateRevision(
            authentication,
            idParam(params),
            requestId,
          ),
        };
      } catch (error) {
        throw mapIntegrationError(error);
      }
    },
  );

  app.post(
    "/api/v1/integrations/agent/exam-revisions/:id/publish",
    async ({ request, params, body }) =>
      agentMutation(
        request,
        options,
        async (authentication, requestId, key) => {
          const authoring = requireExamAuthoring(options);
          const payload = objectPayload(body);
          return authoring.publishRevision(
            authentication,
            idParam(params),
            requiredTimestamp(payload.expectedUpdatedAt, "expectedUpdatedAt"),
            requestId,
            key,
          );
        },
      ),
  );

  app.get(
    "/api/v1/integrations/agent/schedules/:id/summary",
    async ({ request, params }) => {
      try {
        const resultReads = requireResultReads(options);
        const requestId = requestIdOf(request);
        const authentication = await requireAgent(request, options, "read");
        return {
          data: await resultReads.getScheduleSummary(
            authentication,
            idParam(params),
            requestId,
          ),
        };
      } catch (error) {
        throw mapIntegrationError(error);
      }
    },
  );

  app.get(
    "/api/v1/integrations/agent/schedules/:id/results",
    async ({ request, params, query }) => {
      try {
        const resultReads = requireResultReads(options);
        const requestId = requestIdOf(request);
        const authentication = await requireAgent(request, options, "read");
        return {
          data: await resultReads.listScheduleResults(
            authentication,
            idParam(params),
            parseAgentResultQuery(query),
            requestId,
          ),
        };
      } catch (error) {
        throw mapIntegrationError(error);
      }
    },
  );

  app.get(
    "/api/v1/integrations/agent/results/:id",
    async ({ request, params }) => {
      try {
        const resultReads = requireResultReads(options);
        const requestId = requestIdOf(request);
        const authentication = await requireAgent(request, options, "read");
        return {
          data: await resultReads.getResult(
            authentication,
            idParam(params),
            requestId,
          ),
        };
      } catch (error) {
        throw mapIntegrationError(error);
      }
    },
  );

  app.post(
    "/api/v1/integrations/agent/schedules/:id/exports",
    async ({ request, params, body }) =>
      agentMutation(
        request,
        options,
        async (authentication, requestId, idempotencyKey) => {
          const exportService = requireExportService(options);
          const payload = parseAgentExportInput(body);
          return exportService.createExport(
            authentication,
            idParam(params),
            payload,
            requestId,
            idempotencyKey,
          );
        },
      ),
  );

  app.get(
    "/api/v1/integrations/agent/exports/:id",
    async ({ request, params }) => {
      try {
        const exportService = requireExportService(options);
        const requestId = requestIdOf(request);
        const authentication = await requireAgent(request, options, "read");
        return {
          data: await exportService.getStatus(
            authentication,
            idParam(params),
            requestId,
          ),
        };
      } catch (error) {
        throw mapIntegrationError(error);
      }
    },
  );

  app.post(
    "/api/v1/integrations/agent/exports/:id/download-token",
    async ({ request, params }) =>
      agentMutation(request, options, async (authentication, requestId) => {
        const exportService = requireExportService(options);
        return exportService.issueDownloadToken(
          authentication,
          idParam(params),
          requestId,
        );
      }),
  );

  app.get(
    "/api/v1/integrations/agent/exports/:id/download",
    async ({ request, params, query, set }) => {
      try {
        const exportService = requireExportService(options);
        const requestId = requestIdOf(request);
        const authentication = await requireAgent(request, options, "read");
        const token =
          request.headers.get("x-gezycbt-download-token")?.trim() ||
          queryTextValue(query, "token");
        if (!token)
          throw new AppError(
            401,
            "AUTHENTICATION_REQUIRED",
            "Token download diperlukan.",
          );
        const download = await exportService.download(
          authentication,
          idParam(params),
          token,
          requestId,
        );
        set.headers["content-type"] =
          download.format === "JSON"
            ? "application/json; charset=utf-8"
            : "text/csv; charset=utf-8";
        set.headers["content-disposition"] =
          `attachment; filename="gezycbt-export-${download.jobId}.${download.format.toLowerCase()}"`;
        return download.body;
      } catch (error) {
        throw mapIntegrationError(error);
      }
    },
  );

  app.post(
    "/api/v1/integrations/agent/actions/prepare",
    async ({ request, body }) =>
      agentMutation(
        request,
        options,
        async (authentication, requestId, key) => {
          const actions = requireActionService(options);
          return actions.prepare(
            authentication,
            parseAgentActionPrepareInput(body),
            requestId,
            key,
          );
        },
      ),
  );

  app.get("/api/v1/integrations/agent/actions", async ({ request, query }) => {
    try {
      const actions = requireActionService(options);
      const authentication = await requireAgent(request, options, "read");
      const status = queryEnumValue(query, "status", AGENT_ACTION_STATUSES);
      const cursor = queryIdValue(query, "cursor", "cursor");
      const limit = queryLimitValue(query, "limit");
      return {
        data: await actions.list(authentication, {
          ...(status ? { status: status as AgentActionStatus } : {}),
          ...(cursor ? { cursor } : {}),
          limit,
        }),
      };
    } catch (error) {
      throw mapIntegrationError(error);
    }
  });

  app.get(
    "/api/v1/integrations/agent/actions/:id",
    async ({ request, params }) => {
      try {
        const actions = requireActionService(options);
        const authentication = await requireAgent(request, options, "read");
        return {
          data: await actions.get(authentication, idParam(params)),
        };
      } catch (error) {
        throw mapIntegrationError(error);
      }
    },
  );

  app.post(
    "/api/v1/integrations/agent/actions/:id/confirm",
    async ({ request, params, body }) =>
      agentMutation(
        request,
        options,
        async (authentication, requestId, key) => {
          const actions = requireActionService(options);
          const payload = objectPayload(body);
          return actions.confirm(
            authentication,
            idParam(params),
            stringField(payload.planHash, "planHash"),
            requestId,
            key,
          );
        },
      ),
  );

  app.post(
    "/api/v1/integrations/agent/actions/:id/cancel",
    async ({ request, params }) =>
      agentMutation(request, options, async (authentication, requestId) => {
        const actions = requireActionService(options);
        return actions.cancel(authentication, idParam(params), requestId);
      }),
  );

  app.get(
    "/api/v1/integrations/agent/schedules",
    async ({ request, query }) => {
      try {
        const requestId = requestIdOf(request);
        const authentication = await requireAgent(request, options, "read");
        return {
          data: await options.service.searchSchedules(
            authentication,
            parseDiscoveryQuery(query, "schedules"),
            requestId,
          ),
        };
      } catch (error) {
        throw mapIntegrationError(error);
      }
    },
  );

  app.get("/api/v1/admin/integration-clients", async ({ request }) => {
    try {
      await requireAdmin(request, options);
      return {
        data: { items: await options.service.listClients(), nextCursor: null },
      };
    } catch (error) {
      throw mapIntegrationError(error);
    }
  });

  app.get(
    "/api/v1/admin/integration-clients/:id",
    async ({ request, params }) => {
      try {
        await requireAdmin(request, options);
        const clientId = idParam(params);
        const client = await options.service.findClient(clientId);
        if (!client)
          throw new IntegrationNotFoundError(
            "Integration client was not found",
          );
        return {
          data: {
            client,
            credentials: await options.service.listCredentials(clientId),
            grants: await options.service.listGrants(clientId),
          },
        };
      } catch (error) {
        throw mapIntegrationError(error);
      }
    },
  );

  app.post("/api/v1/admin/integration-clients", async ({ request, body }) =>
    adminMutation(request, options, async (admin) => {
      const payload = objectPayload(body);
      return options.service.createClient(
        {
          name: stringField(payload.name, "name"),
          platformHint: stringField(payload.platformHint, "platformHint"),
          ownerUserId: idValue(payload.ownerUserId, "ownerUserId"),
          description: optionalStringOrNull(payload.description),
          createdByUserId: admin.user.id as Id,
        },
        admin.requestId,
      );
    }),
  );

  app.patch(
    "/api/v1/admin/integration-clients/:id",
    async ({ request, params, body }) =>
      adminMutation(request, options, async (admin) => {
        const payload = objectPayload(body);
        const clientId = idParam(params);
        const status = optionalString(payload.status);
        if (status !== undefined) {
          if (
            !INTEGRATION_CLIENT_STATUSES.includes(
              status as IntegrationClientStatus,
            )
          )
            throw new IntegrationValidationError("Client status is invalid");
          const updated = await options.service.setClientStatus(
            clientId,
            status as IntegrationClientStatus,
            admin.user.id as Id,
            optionalTimestamp(payload.expectedUpdatedAt),
            admin.requestId,
          );
          if (!updated)
            throw new IntegrationNotFoundError(
              "Integration client was not found",
            );
          return updated;
        }
        const updated = await options.service.updateClient(
          clientId,
          {
            ...(typeof payload.name === "string" ? { name: payload.name } : {}),
            ...(Object.hasOwn(payload, "description")
              ? { description: optionalStringOrNull(payload.description) }
              : {}),
          },
          optionalTimestamp(payload.expectedUpdatedAt),
          admin.user.id as Id,
          admin.requestId,
        );
        if (!updated)
          throw new IntegrationNotFoundError(
            "Integration client was not found",
          );
        return updated;
      }),
  );

  app.post(
    "/api/v1/admin/integration-clients/:id/credentials",
    async ({ request, params, body }) =>
      adminMutation(request, options, async (admin) => {
        const payload = objectPayload(body);
        const expiresAt = optionalTimestamp(payload.expiresAt);
        const issued = await options.service.issueCredential(
          idParam(params),
          {
            ...(expiresAt ? { expiresAt } : {}),
            rotationParentId: optionalId(payload.rotationParentId),
          },
          admin.user.id as Id,
          admin.requestId,
        );
        return {
          credential: issued.credential,
          token: issued.token,
          warning:
            "Simpan token sekarang. Token plaintext tidak akan ditampilkan lagi.",
        };
      }),
  );

  app.delete(
    "/api/v1/admin/integration-clients/:id/credentials/:credentialId",
    async ({ request, params, body }) =>
      adminMutation(request, options, async (admin) => {
        const payload = objectPayload(body);
        const revoked = await options.service.revokeCredential(
          idParam(params),
          idParam((params as Record<string, unknown>).credentialId),
          admin.user.id as Id,
          stringField(payload.reason, "reason"),
          admin.requestId,
        );
        if (!revoked)
          throw new IntegrationNotFoundError("Active credential was not found");
        return { revoked: true };
      }),
  );

  app.get(
    "/api/v1/admin/integration-clients/:id/grants",
    async ({ request, params }) => {
      try {
        await requireAdmin(request, options);
        const clientId = idParam(params);
        if (!(await options.service.findClient(clientId)))
          throw new IntegrationNotFoundError(
            "Integration client was not found",
          );
        return { data: { items: await options.service.listGrants(clientId) } };
      } catch (error) {
        throw mapIntegrationError(error);
      }
    },
  );

  app.post(
    "/api/v1/admin/integration-clients/:id/grants",
    async ({ request, params, body }) =>
      adminMutation(request, options, async (admin) => {
        const payload = objectPayload(body);
        const scopeType = stringField(payload.scopeType, "scopeType");
        if (!INTEGRATION_SCOPE_TYPES.includes(scopeType as never))
          throw new IntegrationValidationError("Scope type is invalid");
        const scopeIds = payload.scopeIds;
        if (
          !Array.isArray(scopeIds) ||
          scopeIds.some((id) => typeof id !== "string")
        )
          throw new IntegrationValidationError(
            "scopeIds must be an array of IDs",
          );
        const expiresAt = optionalTimestamp(payload.expiresAt);
        const expectedPolicyVersion = optionalInteger(
          payload.expectedPolicyVersion,
        );
        return options.service.createGrant(
          {
            clientId: idParam(params),
            capability: stringField(payload.capability, "capability"),
            scopeType: scopeType as never,
            scopeIds: scopeIds as Id[],
            constraints:
              payload.constraints &&
              typeof payload.constraints === "object" &&
              !Array.isArray(payload.constraints)
                ? (payload.constraints as Readonly<Record<string, unknown>>)
                : {},
            ...(expiresAt ? { expiresAt } : {}),
            issuedByUserId: admin.user.id as Id,
            ...(expectedPolicyVersion !== undefined
              ? { expectedPolicyVersion }
              : {}),
          },
          admin.requestId,
        );
      }),
  );

  app.delete(
    "/api/v1/admin/integration-clients/:id/grants/:grantId",
    async ({ request, params, body }) =>
      adminMutation(request, options, async (admin) => {
        const payload = objectPayload(body);
        const revoked = await options.service.revokeGrant(
          idParam(params),
          idParam((params as Record<string, unknown>).grantId),
          admin.user.id as Id,
          stringField(payload.reason, "reason"),
          admin.requestId,
        );
        if (!revoked)
          throw new IntegrationNotFoundError("Active grant was not found");
        return { revoked: true };
      }),
  );

  app.get("/api/v1/admin/integration-actions", async ({ request, query }) => {
    try {
      await requireAdmin(request, options);
      const actions = requireActionService(options);
      const status = queryEnumValue(query, "status", AGENT_ACTION_STATUSES);
      const clientId = queryIdValue(query, "clientId", "clientId");
      const cursor = queryIdValue(query, "cursor", "cursor");
      return {
        data: await actions.listForAdmin({
          ...(status ? { status: status as AgentActionStatus } : {}),
          ...(clientId ? { clientId } : {}),
          ...(cursor ? { cursor } : {}),
          limit: queryLimitValue(query, "limit"),
        }),
      };
    } catch (error) {
      throw mapIntegrationError(error);
    }
  });

  app.get(
    "/api/v1/admin/integration-actions/:id",
    async ({ request, params }) => {
      try {
        await requireAdmin(request, options);
        const actions = requireActionService(options);
        return { data: await actions.getForAdmin(idParam(params)) };
      } catch (error) {
        throw mapIntegrationError(error);
      }
    },
  );

  app.post(
    "/api/v1/admin/integration-actions/:id/approve",
    async ({ request, params, body }) =>
      adminMutation(request, options, async (admin) => {
        const actions = requireActionService(options);
        const payload = objectPayload(body);
        return actions.approve(
          idParam(params),
          stringField(payload.planHash, "planHash"),
          admin.user.id as Id,
          admin.requestId,
          request.headers.get("idempotency-key") ?? "admin-action-approval",
        );
      }),
  );

  return app;
}

function requireQuestionAuthoring(
  options: IntegrationRouteOptions,
): IntegrationQuestionAuthoringService {
  if (!options.questionAuthoring)
    throw new AppError(
      503,
      "SERVICE_BUSY",
      "Question authoring integration belum tersedia.",
    );
  return options.questionAuthoring;
}

function requireExamAuthoring(
  options: IntegrationRouteOptions,
): IntegrationExamAuthoringService {
  if (!options.examAuthoring)
    throw new AppError(
      503,
      "SERVICE_BUSY",
      "Exam authoring integration belum tersedia.",
    );
  return options.examAuthoring;
}

function requireResultReads(
  options: IntegrationRouteOptions,
): IntegrationResultReadService {
  if (!options.resultReads)
    throw new AppError(
      503,
      "SERVICE_BUSY",
      "Result integration belum tersedia.",
    );
  return options.resultReads;
}

function requireExportService(
  options: IntegrationRouteOptions,
): IntegrationExportService {
  if (!options.exports)
    throw new AppError(
      503,
      "SERVICE_BUSY",
      "Export integration belum tersedia.",
    );
  return options.exports;
}

function requireActionService(
  options: IntegrationRouteOptions,
): IntegrationActionService {
  if (!options.actions)
    throw new AppError(
      503,
      "SERVICE_BUSY",
      "Action integration belum tersedia.",
    );
  return options.actions;
}

async function agentMutation<T>(
  request: Request,
  options: IntegrationRouteOptions,
  operation: (
    authentication: Awaited<ReturnType<typeof requireAgent>>,
    requestId: string,
    idempotencyKey: string,
  ) => Promise<T>,
): Promise<{ data: T }> {
  try {
    const requestId = requestIdOf(request);
    const authentication = await requireAgent(request, options, "mutation");
    const idempotencyKey = requiredAgentIdempotencyKey(request);
    return {
      data: await operation(authentication, requestId, idempotencyKey),
    };
  } catch (error) {
    throw mapIntegrationError(error);
  }
}

function requiredAgentIdempotencyKey(request: Request): string {
  const value = request.headers.get("idempotency-key")?.trim() ?? "";
  if (value.length < 16 || value.length > 128)
    throw new AppError(
      422,
      "VALIDATION_FAILED",
      "Idempotency-Key wajib berisi 16-128 karakter.",
    );
  return value;
}

type AdminIdentity = {
  readonly user: { readonly id: string; readonly role: string };
  readonly requestId: string;
};

async function requireAdmin(
  request: Request,
  options: IntegrationRouteOptions,
): Promise<AdminIdentity> {
  const token = readAuthCookie(request.headers.get("cookie"));
  const session = token ? await options.sessionService.resolve(token) : null;
  if (!session)
    throw new AppError(
      401,
      "AUTH_SESSION_EXPIRED",
      "Sesi login telah berakhir.",
    );
  const user = await options.users.findById(session.userId);
  if (user?.status !== "ACTIVE")
    throw new AppError(
      401,
      "AUTH_SESSION_EXPIRED",
      "Sesi login telah berakhir.",
    );
  if (user.role !== "ADMIN")
    throw new AppError(403, "AUTHORIZATION_DENIED", "Akses admin diperlukan.");
  await verifyCsrfIfMutation(request, session, options);
  return {
    user: { id: user.id, role: user.role },
    requestId: request.headers.get("x-request-id") ?? crypto.randomUUID(),
  };
}

async function adminMutation<T>(
  request: Request,
  options: IntegrationRouteOptions,
  operation: (admin: AdminIdentity) => Promise<T>,
): Promise<{ data: T }> {
  try {
    const admin = await requireAdmin(request, options);
    if (!request.headers.get("idempotency-key"))
      throw new AppError(
        422,
        "VALIDATION_FAILED",
        "Idempotency-Key wajib diisi.",
      );
    if (!options.isReauthenticated(admin.user.id as Id))
      throw new AppError(
        401,
        "REAUTH_REQUIRED",
        "Masuk ulang diperlukan untuk mengubah integrasi.",
      );
    const data = await operation(admin);
    return { data };
  } catch (error) {
    throw mapIntegrationError(error);
  }
}

async function requireAgent(
  request: Request,
  options: IntegrationRouteOptions,
  kind: "read" | "mutation",
) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/u.exec(authorization);
  if (!match?.[1]) throw new IntegrationAuthenticationError();
  const requestId = request.headers.get("x-request-id") ?? undefined;
  return options.service.authenticate(match[1], {
    ...(requestId ? { requestId } : {}),
    kind,
  });
}

async function verifyCsrfIfMutation(
  request: Request,
  session: Awaited<
    ReturnType<IntegrationRouteOptions["sessionService"]["resolve"]>
  >,
  options: IntegrationRouteOptions,
): Promise<void> {
  if (
    request.method === "GET" ||
    request.method === "HEAD" ||
    request.method === "OPTIONS"
  )
    return;
  try {
    await assertCsrfRequest({
      method: request.method,
      origin: request.headers.get("origin"),
      expectedOrigin: options.expectedOrigin,
      csrfToken: request.headers.get(CSRF_HEADER_NAME),
      session,
      verifyCsrfSecret: (id, token) =>
        options.sessionService.verifyCsrfSecret(id, token),
      requireSession: true,
    });
  } catch (error) {
    if (error instanceof CsrfProtectionError)
      throw new AppError(
        error.status,
        error.status === 401 ? "AUTHENTICATION_REQUIRED" : "CSRF_INVALID",
        "Permintaan tidak dapat diverifikasi.",
      );
    throw error;
  }
}

function mapIntegrationError(error: unknown): Error {
  if (error instanceof AppError) return error;
  if (error instanceof AuthorizationRequiredError)
    return new AppError(
      401,
      "AUTHENTICATION_REQUIRED",
      "Identitas actor tidak dapat diverifikasi.",
    );
  if (error instanceof AuthorizationDeniedError)
    return new AppError(
      403,
      "AUTHORIZATION_DENIED",
      "Resource berada di luar scope integrasi.",
    );
  if (error instanceof IntegrationAuthenticationError)
    return new AppError(
      401,
      "AUTHENTICATION_REQUIRED",
      "Credential integrasi tidak valid.",
    );
  if (error instanceof IntegrationRateLimitError)
    return new AppError(
      429,
      "RATE_LIMITED",
      "Batas request integrasi tercapai.",
      { retryAfterSeconds: error.retryAfterSeconds },
    );
  if (error instanceof IntegrationCapabilityError)
    return new AppError(
      403,
      "CAPABILITY_DENIED",
      "Capability tidak diberikan.",
      { capability: error.capability },
    );
  if (error instanceof IntegrationScopeError)
    return new AppError(
      403,
      "AUTHORIZATION_DENIED",
      "Resource berada di luar scope integrasi.",
    );
  if (error instanceof IntegrationNotFoundError)
    return new AppError(
      404,
      "NOT_FOUND",
      "Resource integrasi tidak ditemukan.",
    );
  if (error instanceof IntegrationConflictError)
    return new AppError(
      409,
      "VERSION_CONFLICT",
      "Perubahan integrasi bertabrakan dengan data terbaru.",
    );
  if (error instanceof IntegrationValidationError)
    return new AppError(
      422,
      "VALIDATION_FAILED",
      "Data integrasi tidak valid.",
    );
  if (
    error instanceof AgentQuestionNotFoundError ||
    error instanceof QuestionNotFoundError
  )
    return new AppError(
      404,
      "NOT_FOUND",
      "Soal atau revision tidak ditemukan.",
    );
  if (error instanceof QuestionPublishBlockedError)
    return new AppError(
      422,
      "VALIDATION_FAILED",
      "Soal belum memenuhi publish readiness.",
      { report: error.report },
    );
  if (error instanceof QuestionVersionConflictError)
    return new AppError(
      409,
      "VERSION_CONFLICT",
      "Soal berubah oleh request lain. Muat ulang lalu ulangi.",
    );
  if (
    error instanceof QuestionValidationError ||
    error instanceof QuestionForeignReferenceError
  )
    return new AppError(422, "VALIDATION_FAILED", "Data soal tidak valid.");
  if (error instanceof QuestionImmutableError)
    return new AppError(
      409,
      "VERSION_CONFLICT",
      "Revision published tidak dapat diubah.",
    );
  if (error instanceof AgentExamNotFoundError)
    return new AppError(
      404,
      "NOT_FOUND",
      "Ujian atau revision tidak ditemukan.",
    );
  if (error instanceof ExamPublishBlockedError)
    return new AppError(
      422,
      "VALIDATION_FAILED",
      "Ujian belum memenuhi publish readiness.",
      { report: error.report },
    );
  if (error instanceof ExamVersionConflictError)
    return new AppError(
      409,
      "VERSION_CONFLICT",
      "Ujian berubah oleh request lain. Muat ulang lalu ulangi.",
    );
  if (
    error instanceof ExamRevisionNotFoundError ||
    error instanceof ExamNotFoundError ||
    error instanceof ExamQuestionNotFoundError
  )
    return new AppError(
      404,
      "NOT_FOUND",
      "Ujian atau soal yang dipilih tidak ditemukan.",
    );
  if (
    error instanceof ExamImmutableError ||
    error instanceof ExamQuestionDuplicateError ||
    error instanceof ExamQuestionOrderError ||
    error instanceof ExamPublishInvariantError
  )
    return new AppError(
      409,
      "VERSION_CONFLICT",
      "Perubahan ujian tidak dapat diterapkan pada state saat ini.",
    );
  if (error instanceof ExamValidationError)
    return new AppError(422, "VALIDATION_FAILED", "Data ujian tidak valid.");
  if (error instanceof AgentResultNotFoundError)
    return new AppError(
      404,
      "NOT_FOUND",
      "Jadwal atau hasil ujian tidak ditemukan.",
    );
  if (
    error instanceof AgentExportNotFoundError ||
    error instanceof ExportNotFoundError
  )
    return new AppError(404, "NOT_FOUND", "Export tidak ditemukan.");
  if (error instanceof AgentExportPiiDeniedError)
    return new AppError(
      403,
      "CAPABILITY_DENIED",
      "Grant integrasi tidak mengizinkan export PII.",
    );
  if (error instanceof ExportActiveError)
    return new AppError(
      409,
      "EXPORT_ACTIVE",
      "Masih ada export aktif untuk client ini.",
    );
  if (error instanceof ExportNotReadyError)
    return new AppError(409, "EXPORT_NOT_READY", "Export belum siap diunduh.");
  if (error instanceof ExportDownloadTokenError)
    return new AppError(
      409,
      "DOWNLOAD_TOKEN_INVALID",
      "Token download tidak valid atau sudah digunakan.",
    );
  if (
    error instanceof ExportIdempotencyConflictError ||
    error instanceof ExportIdempotencyInProgressError
  )
    return new AppError(
      409,
      error instanceof ExportIdempotencyConflictError
        ? "IDEMPOTENCY_CONFLICT"
        : "IDEMPOTENCY_IN_PROGRESS",
      error instanceof ExportIdempotencyConflictError
        ? "Idempotency-Key sudah dipakai untuk export berbeda."
        : "Permintaan export dengan key tersebut masih diproses.",
    );
  if (error instanceof ExportValidationError)
    return new AppError(422, "VALIDATION_FAILED", error.message);
  if (error instanceof AgentActionNotFoundError)
    return new AppError(404, "NOT_FOUND", "Action tidak ditemukan.");
  if (error instanceof AgentActionPlanMismatchError)
    return new AppError(
      409,
      "ACTION_PLAN_MISMATCH",
      "Plan action sudah berubah. Buat plan baru.",
    );
  if (error instanceof AgentActionGrantChangedError)
    return new AppError(
      409,
      "ACTION_GRANT_CHANGED",
      "Grant berubah. Buat plan baru terhadap grant terbaru.",
    );
  if (error instanceof AgentActionApprovalRequiredError)
    return new AppError(
      409,
      "ACTION_APPROVAL_REQUIRED",
      "Action menunggu persetujuan admin melalui web.",
    );
  if (error instanceof AgentActionExpiredError)
    return new AppError(409, "ACTION_EXPIRED", "Action sudah kedaluwarsa.");
  if (error instanceof AgentActionExecutionError)
    return new AppError(
      503,
      "SERVICE_BUSY",
      "Action belum dapat diselesaikan. Coba periksa status action lalu ulangi bila masih pending.",
    );
  if (error instanceof AgentActionConflictError)
    return new AppError(
      409,
      error.code,
      "Action tidak dapat diproses pada state saat ini.",
    );
  if (error instanceof AgentActionValidationError)
    return new AppError(422, "VALIDATION_FAILED", error.message);
  if (
    error instanceof MediaValidationError ||
    error instanceof MediaRelationValidationError
  )
    return new AppError(422, "VALIDATION_FAILED", "Data media tidak valid.", {
      mediaCode: error.code,
    });
  if (error instanceof MediaRelationNotFoundError)
    return new AppError(404, "NOT_FOUND", "Media relation tidak ditemukan.");
  if (
    error instanceof MediaRelationConflictError ||
    error instanceof MediaRelationImmutableError ||
    error instanceof MediaAssetReferencedError ||
    error instanceof MediaPublishedReferenceError
  )
    return new AppError(
      409,
      "VERSION_CONFLICT",
      "Perubahan media tidak dapat diterapkan.",
    );
  if (error instanceof MediaPersistenceError)
    return new AppError(500, "INTERNAL_ERROR", "Media tidak dapat disimpan.");
  if (error instanceof DiskProtectionError)
    return new AppError(
      503,
      "DISK_PRESSURE",
      "Penyimpanan server hampir penuh. Upload/export ditunda.",
      { retryAfterSeconds: 300 },
    );
  return error instanceof Error
    ? error
    : new Error("Integration request failed");
}

function questionContentPayload(payload: Record<string, unknown>): {
  type: "SINGLE_CHOICE" | "MULTIPLE_RESPONSE" | "TRUE_FALSE";
  stimulusHtml: string;
  promptHtml: string | null;
  explanationHtml: string | null;
  options: readonly {
    position: number;
    contentHtml: string;
    isCorrect: boolean;
    id?: Id;
  }[];
  statements: readonly {
    position: number;
    statementHtml: string;
    correctValue: boolean;
    id?: Id;
  }[];
} {
  const type = stringField(payload.type, "type");
  if (
    type !== "SINGLE_CHOICE" &&
    type !== "MULTIPLE_RESPONSE" &&
    type !== "TRUE_FALSE"
  )
    throw new AppError(422, "VALIDATION_FAILED", "type tidak valid.");
  const options = arrayPayload(payload.options, "options").map((value) => {
    const item = objectPayload(value);
    return {
      ...(item.id === undefined ? {} : { id: idValue(item.id, "option.id") }),
      position: requiredInteger(item.position, "option.position"),
      contentHtml: stringField(item.contentHtml, "option.contentHtml"),
      isCorrect: booleanField(item.isCorrect, "option.isCorrect"),
    };
  });
  const statements = arrayPayload(payload.statements, "statements").map(
    (value) => {
      const item = objectPayload(value);
      return {
        ...(item.id === undefined
          ? {}
          : { id: idValue(item.id, "statement.id") }),
        position: requiredInteger(item.position, "statement.position"),
        statementHtml: stringField(
          item.statementHtml,
          "statement.statementHtml",
        ),
        correctValue: booleanField(item.correctValue, "statement.correctValue"),
      };
    },
  );
  return {
    type,
    stimulusHtml: stringField(payload.stimulusHtml, "stimulusHtml"),
    promptHtml: nullableString(payload.promptHtml, "promptHtml"),
    explanationHtml: nullableString(payload.explanationHtml, "explanationHtml"),
    options,
    statements,
  };
}

function examMetadataPayload(payload: Record<string, unknown>): {
  title: string;
  instructionsHtml: string;
  durationSeconds: number;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
} {
  return {
    title: stringField(payload.title, "title"),
    instructionsHtml: stringValue(payload.instructionsHtml, "instructionsHtml"),
    durationSeconds: requiredInteger(
      payload.durationSeconds,
      "durationSeconds",
    ),
    shuffleQuestions: booleanField(
      payload.shuffleQuestions,
      "shuffleQuestions",
    ),
    shuffleOptions: booleanField(payload.shuffleOptions, "shuffleOptions"),
  };
}

function examMetadataPatchPayload(payload: Record<string, unknown>): {
  title?: string;
  instructionsHtml?: string;
  durationSeconds?: number;
  shuffleQuestions?: boolean;
  shuffleOptions?: boolean;
} {
  const result: {
    title?: string;
    instructionsHtml?: string;
    durationSeconds?: number;
    shuffleQuestions?: boolean;
    shuffleOptions?: boolean;
  } = {};
  if (Object.hasOwn(payload, "title"))
    result.title = stringField(payload.title, "title");
  if (Object.hasOwn(payload, "instructionsHtml"))
    result.instructionsHtml = stringValue(
      payload.instructionsHtml,
      "instructionsHtml",
    );
  if (Object.hasOwn(payload, "durationSeconds"))
    result.durationSeconds = requiredInteger(
      payload.durationSeconds,
      "durationSeconds",
    );
  if (Object.hasOwn(payload, "shuffleQuestions"))
    result.shuffleQuestions = booleanField(
      payload.shuffleQuestions,
      "shuffleQuestions",
    );
  if (Object.hasOwn(payload, "shuffleOptions"))
    result.shuffleOptions = booleanField(
      payload.shuffleOptions,
      "shuffleOptions",
    );
  return result;
}

function arrayPayload(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value))
    throw new AppError(
      422,
      "VALIDATION_FAILED",
      `${field} harus berupa array.`,
    );
  return value;
}

function booleanField(value: unknown, field: string): boolean {
  if (typeof value !== "boolean")
    throw new AppError(
      422,
      "VALIDATION_FAILED",
      `${field} harus berupa boolean.`,
    );
  return value;
}

function requiredInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1)
    throw new AppError(422, "VALIDATION_FAILED", `${field} tidak valid.`);
  return Number(value);
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string")
    throw new AppError(422, "VALIDATION_FAILED", `${field} tidak valid.`);
  return value;
}

function requiredTimestamp(value: unknown, field: string): UtcTimestamp {
  const parsed = optionalTimestamp(value);
  if (!parsed)
    throw new AppError(422, "VALIDATION_FAILED", `${field} wajib diisi.`);
  return parsed;
}

function queryBoolean(value: unknown, field: string): boolean {
  if (value === undefined || value === null || value === "") return false;
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  throw new AppError(
    422,
    "VALIDATION_FAILED",
    `Parameter ${field} tidak valid.`,
  );
}

function objectPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AppError(422, "VALIDATION_FAILED", "Format request tidak valid.");
  return value as Record<string, unknown>;
}
function stringField(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new AppError(422, "VALIDATION_FAILED", `${field} wajib diisi.`);
  return value;
}
function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string")
    throw new AppError(422, "VALIDATION_FAILED", `${field} tidak valid.`);
  return value;
}
function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
function optionalStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
function idValue(value: unknown, field: string): Id {
  if (typeof value !== "string" || !/^\d+$/u.test(value))
    throw new AppError(422, "VALIDATION_FAILED", `${field} tidak valid.`);
  return value as Id;
}
function optionalId(value: unknown): Id | null {
  return value === undefined || value === null || value === ""
    ? null
    : idValue(value, "ID");
}
function idParam(params: unknown): Id {
  const value = String((params as Record<string, unknown>).id ?? "");
  return idValue(value, "ID");
}
function optionalInteger(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new AppError(422, "VALIDATION_FAILED", "Nilai integer tidak valid.");
  return parsed;
}
function optionalTimestamp(value: unknown): UtcTimestamp | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value)))
    throw new AppError(422, "VALIDATION_FAILED", "Timestamp tidak valid.");
  return value as UtcTimestamp;
}

function requestIdOf(request: Request): string {
  return request.headers.get("x-request-id") ?? crypto.randomUUID();
}

function parseDiscoveryQuery(
  value: unknown,
  resource: DiscoveryResourceType,
): DiscoveryQuery {
  const candidate =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const q = queryText(candidate.q);
  const cursor = queryId(candidate.cursor, "cursor");
  const limit = queryLimit(candidate.limit);
  const subjectId = queryId(candidate.subjectId, "subjectId");
  const questionBankId = queryId(candidate.questionBankId, "questionBankId");
  const academicYearId = queryId(candidate.academicYearId, "academicYearId");
  const examId = queryId(candidate.examId, "examId");
  const status = queryEnum(candidate.status, resourceStatusValues(resource));
  const revisionStatus = queryEnum(candidate.revisionStatus, [
    "DRAFT",
    "PUBLISHED",
  ]);
  const type = queryEnum(candidate.type, [
    "SINGLE_CHOICE",
    "MULTIPLE_RESPONSE",
    "TRUE_FALSE",
  ]);
  const mode = queryEnum(candidate.mode, ["MAIN", "PRACTICE"]);
  return {
    ...(q ? { q } : {}),
    ...(cursor ? { cursor } : {}),
    limit,
    ...(subjectId ? { subjectId } : {}),
    ...(questionBankId ? { questionBankId } : {}),
    ...(academicYearId ? { academicYearId } : {}),
    ...(examId ? { examId } : {}),
    ...(status ? { status } : {}),
    ...(revisionStatus ? { revisionStatus } : {}),
    ...(type ? { type } : {}),
    ...(mode ? { mode } : {}),
  };
}

function parseAgentResultQuery(value: unknown): {
  readonly cursor?: Id;
  readonly limit: number;
  readonly filter?: "RELEASED" | "UNRELEASED";
} {
  const candidate =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const cursor = queryId(candidate.cursor, "cursor");
  const rawLimit =
    candidate.limit === undefined || candidate.limit === ""
      ? 50
      : Number(candidate.limit);
  if (!Number.isSafeInteger(rawLimit) || rawLimit < 1 || rawLimit > 100)
    throw new AppError(
      422,
      "VALIDATION_FAILED",
      "Parameter limit harus berupa integer 1-100.",
    );
  const rawFilter = candidate.filter;
  if (
    rawFilter !== undefined &&
    rawFilter !== "" &&
    rawFilter !== "RELEASED" &&
    rawFilter !== "UNRELEASED"
  )
    throw new AppError(422, "VALIDATION_FAILED", "Filter result tidak valid.");
  return {
    ...(cursor ? { cursor } : {}),
    limit: rawLimit,
    ...(rawFilter === "RELEASED" || rawFilter === "UNRELEASED"
      ? { filter: rawFilter }
      : {}),
  };
}

function parseAgentExportInput(value: unknown): AgentExportInput {
  const payload = objectPayload(value);
  const format = payload.format ?? "CSV";
  if (
    typeof format !== "string" ||
    !EXPORT_FORMATS.includes(format as ExportFormat)
  )
    throw new AppError(422, "VALIDATION_FAILED", "Format export tidak valid.");
  const includePii = payload.includePii ?? false;
  if (typeof includePii !== "boolean")
    throw new AppError(
      422,
      "VALIDATION_FAILED",
      "includePii harus berupa boolean.",
    );
  let filter: AgentExportInput["filter"];
  if (payload.filter !== undefined) {
    const filterPayload = objectPayload(payload.filter);
    const release = filterPayload.release;
    if (release !== "RELEASED" && release !== "UNRELEASED")
      throw new AppError(
        422,
        "VALIDATION_FAILED",
        "Filter release tidak valid.",
      );
    filter = { release };
  }
  let columns: readonly ExportColumn[] | undefined;
  if (payload.columns !== undefined) {
    if (!Array.isArray(payload.columns) || payload.columns.length === 0)
      throw new AppError(
        422,
        "VALIDATION_FAILED",
        "columns harus berupa array yang tidak kosong.",
      );
    columns = payload.columns.map((column) => {
      if (
        typeof column !== "string" ||
        !EXPORT_COLUMNS.includes(column as ExportColumn)
      )
        throw new AppError(
          422,
          "VALIDATION_FAILED",
          "Kolom export tidak didukung.",
        );
      return column as ExportColumn;
    });
  }
  return {
    format: format as ExportFormat,
    includePii,
    ...(filter ? { filter } : {}),
    ...(columns ? { columns } : {}),
  };
}

function parseAgentActionPrepareInput(value: unknown) {
  const payload = objectPayload(value);
  const operation = stringField(payload.operation, "operation");
  if (!AGENT_ACTION_OPERATIONS.includes(operation as AgentActionOperation))
    throw new AppError(
      422,
      "VALIDATION_FAILED",
      "Operation action tidak didukung.",
    );
  const target =
    payload.target &&
    typeof payload.target === "object" &&
    !Array.isArray(payload.target)
      ? (payload.target as Record<string, unknown>)
      : payload;
  const targetType = stringField(
    target.type ?? target.targetType,
    "target.type",
  );
  if (!AGENT_ACTION_TARGET_TYPES.includes(targetType as never))
    throw new AppError(
      422,
      "VALIDATION_FAILED",
      "Target type action tidak didukung.",
    );
  const targetId = idValue(target.id ?? target.targetId, "target.id");
  let parameters: Readonly<Record<string, unknown>> | undefined;
  if (payload.parameters !== undefined) {
    if (
      !payload.parameters ||
      typeof payload.parameters !== "object" ||
      Array.isArray(payload.parameters)
    )
      throw new AppError(
        422,
        "VALIDATION_FAILED",
        "parameters harus berupa object.",
      );
    parameters = payload.parameters as Readonly<Record<string, unknown>>;
  }
  return {
    operation: operation as AgentActionOperation,
    targetType: targetType as never,
    targetId,
    ...(parameters ? { parameters } : {}),
  };
}

function queryTextValue(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string")
    throw new AppError(422, "VALIDATION_FAILED", `${field} tidak valid.`);
  return value;
}

function queryParam(query: unknown, field: string): unknown {
  if (!query || typeof query !== "object" || Array.isArray(query))
    return undefined;
  return (query as Record<string, unknown>)[field];
}

function queryIdValue(
  query: unknown,
  field: string,
  label: string,
): Id | undefined {
  return queryId(queryParam(query, field), label);
}

function queryLimitValue(query: unknown, field: string): number {
  const value = queryParam(query, field);
  if (value === undefined || value === null || value === "") return 20;
  return queryLimit(value);
}

function queryEnumValue(
  query: unknown,
  field: string,
  allowed: readonly string[],
): string | undefined {
  return queryEnum(queryParam(query, field), allowed);
}

function queryText(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string")
    throw new AppError(422, "VALIDATION_FAILED", "Parameter q tidak valid.");
  const normalized = value.normalize("NFKC").trim();
  if (normalized.length > 200)
    throw new AppError(
      422,
      "VALIDATION_FAILED",
      "Parameter q terlalu panjang.",
    );
  return normalized || undefined;
}

function queryId(value: unknown, field: string): Id | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !/^\d+$/u.test(value))
    throw new AppError(
      422,
      "VALIDATION_FAILED",
      `Parameter ${field} tidak valid.`,
    );
  return value as Id;
}

function queryLimit(value: unknown): number {
  if (value === undefined || value === null || value === "") return 20;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 20)
    throw new AppError(
      422,
      "VALIDATION_FAILED",
      "Parameter limit harus berupa integer 1-20.",
    );
  return parsed;
}

function queryEnum(
  value: unknown,
  allowed: readonly string[],
): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !allowed.includes(value))
    throw new AppError(
      422,
      "VALIDATION_FAILED",
      "Filter discovery tidak valid.",
    );
  return value;
}

function resourceStatusValues(
  resource: DiscoveryResourceType,
): readonly string[] {
  switch (resource) {
    case "subjects":
    case "classes":
    case "question_banks":
      return ["ACTIVE", "ARCHIVED"];
    case "questions":
      return ["ACTIVE", "ARCHIVED"];
    case "exams":
      return ["DRAFT", "PUBLISHED", "ARCHIVED"];
    case "schedules":
      return ["DRAFT", "READY", "OPEN", "CLOSED", "ARCHIVED"];
  }
}
