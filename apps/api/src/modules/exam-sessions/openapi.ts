import {
  type ExamSessionApiRouteContract,
  examSessionApiOpenApiSchemas,
  examSessionApiRoutes,
} from "./api-contract";

export const examSessionApiOpenApi = {
  openapi: "3.1.0" as const,
  info: {
    title: "GezyCBT Exam Runtime API",
    version: "1.0.0",
    description:
      "Participant-safe session start, resume, autosave, and submit contracts.",
  },
  paths: buildPaths(examSessionApiRoutes),
  components: {
    schemas: examSessionApiOpenApiSchemas,
    securitySchemes: {
      participantCookie: {
        type: "apiKey",
        in: "cookie",
        name: "__Host-gezycbt-auth",
      },
      practiceCookie: {
        type: "apiKey",
        in: "cookie",
        name: "__Host-gezycbt-practice",
      },
    },
  },
};

function buildPaths(routes: readonly ExamSessionApiRouteContract[]) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of routes) {
    const path = route.path.replace(/:([A-Za-z][A-Za-z0-9_]*)/gu, "{$1}");
    const parameters = Object.entries(
      route.request?.params?.properties ?? {},
    ).map(([name, schema]) => ({ name, in: "path", required: true, schema }));
    const operation: Record<string, unknown> = {
      tags: ["Exam runtime"],
      operationId: route.operationId,
      summary: route.operationId,
      security: route.security ?? [{ participantCookie: [] }],
      parameters,
      responses: {
        "200": { description: "Berhasil" },
        "401": { description: "Authentication required" },
        "409": { description: "Runtime state conflict" },
        "422": { description: "Invalid answer shape" },
        "429": { description: "Rate limited" },
        "503": { description: "Service busy" },
      },
    };
    if (route.request?.body)
      operation.requestBody = {
        required: true,
        content: { "application/json": { schema: route.request.body } },
      };
    paths[path] = {
      ...(paths[path] ?? {}),
      [route.method.toLowerCase()]: operation,
    };
  }
  return paths;
}
