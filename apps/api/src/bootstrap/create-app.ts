import type { AppConfig } from "@gezycbt/config";
import type { ApiErrorBody } from "@gezycbt/contracts";
import { Elysia } from "elysia";
import { AppError } from "../http/app-error";
import { type AppLogger, consoleLogger } from "../http/logger";
import { examSessionApiOpenApi } from "../modules/exam-sessions/openapi";
import { questionApiOpenApi } from "../modules/questions/openapi";
import { scheduleApiOpenApi } from "../modules/schedules/openapi";
import { checkReadiness, type ReadinessCheck } from "../observability/health";
import type { Metrics } from "../observability/metrics";
import {
  beginRequest,
  createMetrics,
  finishRequest,
  renderMetrics,
} from "../observability/metrics";

const trustedRequestId = /^[a-zA-Z0-9_-]{8,128}$/;

const apiOpenApi = {
  ...questionApiOpenApi,
  info: {
    ...questionApiOpenApi.info,
    title: "GezyCBT API",
    description:
      "GezyCBT authoring and schedule contracts. Participant payloads remain separate from staff resources.",
  },
  paths: {
    ...questionApiOpenApi.paths,
    ...scheduleApiOpenApi.paths,
    ...examSessionApiOpenApi.paths,
  },
  components: {
    schemas: {
      ...questionApiOpenApi.components.schemas,
      ...scheduleApiOpenApi.components.schemas,
      ...examSessionApiOpenApi.components.schemas,
    },
    securitySchemes: {
      ...questionApiOpenApi.components.securitySchemes,
      ...scheduleApiOpenApi.components.securitySchemes,
      ...examSessionApiOpenApi.components.securitySchemes,
    },
  },
};

export interface AppDependencies {
  readonly readinessChecks?: readonly ReadinessCheck[];
  readonly metrics?: Metrics;
  /** Register concrete route plugins after the base app has been created. */
  readonly registerRoutes?: (app: Elysia) => unknown;
}

export function createApp(
  config: AppConfig,
  logger: AppLogger = consoleLogger,
  dependencies: AppDependencies = {},
) {
  const metrics = dependencies.metrics ?? createMetrics();
  const startedAt = Date.now();
  const app = new Elysia({ name: "gezycbt-api" });
  app
    .decorate("config", config)
    .get("/health/live", ({ set }) => {
      set.headers["cache-control"] = "no-store";
      return { status: "ok", release: config.appRelease };
    })
    .get("/health/ready", async ({ set }) => {
      const health = await checkReadiness(dependencies.readinessChecks ?? []);
      set.status = health.status === "ok" ? 200 : 503;
      set.headers["cache-control"] = "no-store";
      return health;
    })
    .get("/metrics", ({ set }) => {
      set.headers["content-type"] = "text/plain; version=0.0.4";
      set.headers["cache-control"] = "no-store";
      return renderMetrics(metrics, startedAt);
    });

  // OpenAPI is intentionally absent from production until an authenticated
  // admin documentation route is introduced. Development/staging need the
  // static contract for client generation and manual review.
  if (config.appEnv !== "production") {
    app.get("/openapi.json", ({ set }) => {
      set.headers["content-type"] = "application/json; charset=utf-8";
      set.headers["cache-control"] = "no-store";
      return apiOpenApi;
    });
  }

  const configured = app
    .onRequest(({ request }) => {
      beginRequest(metrics, request);
    })
    .derive(({ request, set }) => {
      const supplied = request.headers.get("x-request-id");
      const requestId =
        supplied && trustedRequestId.test(supplied)
          ? supplied
          : crypto.randomUUID();
      set.headers["x-request-id"] = requestId;
      return { requestId };
    })
    .onAfterHandle(({ request }) => {
      metrics.requestsTotal += 1;
      finishRequest(metrics, request, new URL(request.url).pathname);
    });

  const withErrors = configured.onError(
    ({ code, error, request, requestId, set }) => {
      metrics.errorsTotal += 1;
      finishRequest(metrics, request, new URL(request.url).pathname);
      const errorRequestId = requestId ?? crypto.randomUUID();
      set.headers["x-request-id"] = errorRequestId;
      const mapped =
        code === "NOT_FOUND"
          ? new AppError(404, "NOT_FOUND", "Resource tidak ditemukan.")
          : error instanceof AppError
            ? error
            : new AppError(
                500,
                "INTERNAL_ERROR",
                "Terjadi kesalahan pada server.",
              );
      set.status = mapped.status;
      logger.error({
        level: "error",
        event: "request_failed",
        requestId: errorRequestId,
        method: request.method,
        path: new URL(request.url).pathname,
        status: mapped.status,
        errorCode: mapped.code,
      });
      return {
        error: {
          code: mapped.code,
          message: mapped.message,
          requestId: errorRequestId,
          details: mapped.details,
        },
      } satisfies ApiErrorBody;
    },
  );

  // Elysia's fluent type carries every route schema in its generic state. The
  // registrar is an application composition boundary, so keep that detail
  // out of AppDependencies while preserving the concrete runtime instance.
  const registered = dependencies.registerRoutes?.(
    withErrors as unknown as Elysia,
  );
  return registered instanceof Elysia
    ? (registered as unknown as typeof withErrors)
    : withErrors;
}
