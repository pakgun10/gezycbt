import {
  type QuestionApiRouteContract,
  questionApiOpenApiSchemas,
  questionApiRoutes,
} from "./api-contract";

export interface QuestionOpenApiDocument {
  readonly openapi: "3.1.0";
  readonly info: {
    readonly title: string;
    readonly version: string;
    readonly description: string;
  };
  readonly paths: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly components: {
    readonly schemas: Readonly<Record<string, unknown>>;
    readonly securitySchemes: Readonly<Record<string, unknown>>;
  };
}

const errorSchema = {
  type: "object",
  additionalProperties: false,
  required: ["error"],
  properties: {
    error: {
      type: "object",
      additionalProperties: false,
      required: ["code", "message", "requestId", "details"],
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        requestId: { type: "string" },
        details: { type: "object", additionalProperties: true },
      },
    },
  },
} as const;

const schemaRefs: Readonly<Record<string, string>> = {
  questionBankListResponse: "QuestionBankListResponse",
  questionBankResponse: "QuestionBankResponse",
  questionRevisionPageResponse: "QuestionRevisionPageResponse",
  questionRevisionResponse: "QuestionRevisionResponse",
  readinessResponse: "QuestionReadinessResponse",
  mediaAssetResponse: "MediaAssetResponse",
  questionMediaResponse: "QuestionMediaResponse",
  questionImportPreviewResponse: "QuestionImportPreviewResponse",
  questionImportCommitResponse: "QuestionImportCommitResponse",
};

const responseDefinitions = {
  QuestionBankListResponse: successSchema("QuestionBankPage"),
  QuestionBankResponse: successSchema("QuestionBank"),
  QuestionRevisionPageResponse: successSchema("QuestionRevisionPage"),
  QuestionRevisionResponse: successSchema("QuestionRevision"),
  QuestionReadinessResponse: successSchema("QuestionReadinessReport"),
  MediaAssetResponse: successSchema("MediaAsset"),
  QuestionMediaResponse: successSchema("QuestionMedia"),
  QuestionImportPreviewResponse: successSchema("QuestionImportPreview"),
  QuestionImportCommitResponse: successSchema("QuestionImportCommitResult"),
};

export const questionApiOpenApi: QuestionOpenApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "GezyCBT Question Authoring API",
    version: "1.0.0",
    description:
      "Teacher-scoped question bank, revision, readiness, publish, and media contracts. Participant payloads never use the teacher revision schema.",
  },
  paths: buildPaths(questionApiRoutes),
  components: {
    schemas: {
      ...questionApiOpenApiSchemas,
      ...responseDefinitions,
      ErrorResponse: errorSchema,
    },
    securitySchemes: {
      staffCookie: {
        type: "apiKey",
        in: "cookie",
        name: "__Host-gezycbt-auth",
        description:
          "Opaque staff auth session cookie; CSRF remains required for mutations.",
      },
    },
  },
};

function successSchema(schemaName: string) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["data"],
    properties: {
      data: { $ref: `#/components/schemas/${schemaName}` },
    },
  } as const;
}

function buildPaths(
  routes: readonly QuestionApiRouteContract[],
): Readonly<Record<string, Readonly<Record<string, unknown>>>> {
  const result: Record<string, Record<string, unknown>> = {};
  for (const route of routes) {
    const path = route.path.replace(/:([A-Za-z][A-Za-z0-9_]*)/gu, "{$1}");
    const method = route.method.toLowerCase();
    const operation: Record<string, unknown> = {
      tags: ["Question authoring"],
      operationId: route.operationId,
      summary: route.summary,
      security: [{ staffCookie: [] }],
      responses: buildResponses(route),
    };
    const parameters = [
      ...parametersFromSchema(route.request?.params, "path", true),
      ...parametersFromSchema(route.request?.query, "query", false),
      ...parametersFromSchema(route.request?.headers, "header", false),
    ];
    if (parameters.length > 0) operation.parameters = parameters;
    if (route.request?.body) {
      operation.requestBody = {
        required: true,
        content: {
          [route.path === "/api/v1/teacher/media"
            ? "multipart/form-data"
            : "application/json"]: { schema: route.request.body },
        },
      };
    }
    result[path] = { ...(result[path] ?? {}), [method]: operation };
  }
  return result;
}

function buildResponses(
  route: QuestionApiRouteContract,
): Record<string, unknown> {
  const responseStatus = route.response?.status ?? 204;
  const success: Record<string, unknown> = {
    description: responseStatus === 204 ? "Berhasil" : "Berhasil",
  };
  const schemaName = route.response?.schemaName
    ? schemaRefs[route.response.schemaName]
    : undefined;
  if (schemaName) {
    success.content = {
      "application/json": {
        schema: { $ref: `#/components/schemas/${schemaName}` },
      },
    };
  }
  return {
    [String(responseStatus)]: success,
    "401": errorResponse("Authentication required"),
    "403": errorResponse("Authorization denied"),
    "404": errorResponse("Resource not found"),
    "409": errorResponse("Version or state conflict"),
    "422": errorResponse("Validation failed"),
    "429": errorResponse("Rate limited"),
  };
}

function errorResponse(description: string) {
  return {
    description,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/ErrorResponse" },
      },
    },
  } as const;
}

function parametersFromSchema(
  schema: unknown,
  location: "path" | "query" | "header",
  forceRequired: boolean,
): readonly Record<string, unknown>[] {
  if (!schema || typeof schema !== "object") return [];
  const candidate = schema as {
    properties?: Record<string, unknown>;
    required?: readonly string[];
  };
  if (!candidate.properties) return [];
  const required = new Set(candidate.required ?? []);
  return Object.entries(candidate.properties).map(([name, propertySchema]) => ({
    name,
    in: location,
    required: forceRequired || required.has(name),
    schema: propertySchema,
  }));
}
