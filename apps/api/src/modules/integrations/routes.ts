import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import type { DatabasePort } from "@gezycbt/database";
import { Elysia } from "elysia";
import { AppError } from "../../http/app-error";
import {
  assertCsrfRequest,
  CSRF_HEADER_NAME,
  CsrfProtectionError,
} from "../auth/csrf";
import { type AuthSessionService, readAuthCookie } from "../auth/session";
import type { StoredUser } from "../users";
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

  return app;
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
  return error instanceof Error
    ? error
    : new Error("Integration request failed");
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
