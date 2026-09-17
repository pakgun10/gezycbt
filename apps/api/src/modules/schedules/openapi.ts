import { scheduleApiOpenApiSchemas, scheduleApiRoutes } from "./api-contract";

export interface ScheduleOpenApiDocument {
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

export const scheduleApiOpenApi: ScheduleOpenApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "GezyCBT Schedule API",
    version: "1.0.0",
    description:
      "Teacher-scoped schedule authoring, lifecycle, and access-code contracts. Raw access digests never appear in schedule responses.",
  },
  paths: buildPaths(),
  components: {
    schemas: {
      ...scheduleApiOpenApiSchemas,
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

function buildPaths(): Readonly<
  Record<string, Readonly<Record<string, unknown>>>
> {
  const result: Record<string, Record<string, unknown>> = {};
  for (const route of scheduleApiRoutes) {
    const path = route.path.replace(/:([A-Za-z][A-Za-z0-9_]*)/gu, "{$1}");
    const operation: Record<string, unknown> = {
      tags: ["Schedules"],
      operationId: route.operationId,
      summary: route.summary,
      security: [{ staffCookie: [] }],
      responses: {
        [String(route.response?.status ?? 200)]: {
          description: "Berhasil",
          ...(route.response?.schemaName
            ? {
                content: {
                  "application/json": {
                    schema: {
                      $ref: `#/components/schemas/${schemaName(route.response.schemaName)}`,
                    },
                  },
                },
              }
            : {}),
        },
        "401": errorResponse("Authentication required"),
        "403": errorResponse("Authorization denied"),
        "404": errorResponse("Resource not found"),
        "409": errorResponse("Version or state conflict"),
        "422": errorResponse("Validation failed"),
        "429": errorResponse("Rate limited"),
      },
    };
    if (route.request?.body) {
      operation.requestBody = {
        required: true,
        content: { "application/json": { schema: route.request.body } },
      };
    }
    result[path] = {
      ...(result[path] ?? {}),
      [route.method.toLowerCase()]: operation,
    };
  }
  return result;
}

function schemaName(name: string): string {
  const names: Record<string, string> = {
    scheduleResponse: "ScheduleResponse",
    schedulePageResponse: "SchedulePageResponse",
    rotatedAccessCodeResponse: "RotatedScheduleAccessCodeResponse",
  };
  return names[name] ?? name;
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
