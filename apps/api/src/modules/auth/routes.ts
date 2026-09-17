import { AppError } from "../../http/app-error";
import { createCsrfGuard } from "./csrf";
import {
  type AuthLoginService,
  InvalidLoginError,
  LoginRateLimitedError,
} from "./login";
import { PasswordBusyError } from "./password";
import type { AuthSessionService } from "./session";

export interface AuthRoutesOptions {
  readonly loginService: AuthLoginService;
  readonly sessionService: Pick<
    AuthSessionService,
    "resolve" | "verifyCsrfSecret"
  >;
  readonly expectedOrigin: URL | string;
  /** Resolve the peer/proxy address only from a trusted server adapter. */
  readonly getClientIp?: (request: Request) => string | undefined;
}

export function createAuthRoutes(options: AuthRoutesOptions) {
  const csrf = createCsrfGuard({
    expectedOrigin: options.expectedOrigin,
    sessionService: options.sessionService,
    requireSession: false,
  });
  return csrf
    .post("/api/v1/auth/staff/login", async ({ body, request, set }) => {
      const credentials = parseLoginBody(body);
      const clientIp = options.getClientIp?.(request);
      const result = await runLogin(() =>
        options.loginService.loginStaff({
          ...credentials,
          ...(clientIp ? { ipAddress: clientIp } : {}),
        }),
      );
      set.headers["set-cookie"] = result.session.cookie;
      return loginResponse(result);
    })
    .post("/api/v1/auth/participant/login", async ({ body, request, set }) => {
      const credentials = parseLoginBody(body);
      const clientIp = options.getClientIp?.(request);
      const result = await runLogin(() =>
        options.loginService.loginParticipant({
          ...credentials,
          ...(clientIp ? { ipAddress: clientIp } : {}),
        }),
      );
      set.headers["set-cookie"] = result.session.cookie;
      return loginResponse(result);
    });
}

function parseLoginBody(body: unknown): {
  readonly username: string;
  readonly password: string;
} {
  if (!body || typeof body !== "object") {
    throw new AppError(422, "VALIDATION_FAILED", "Format login tidak valid.");
  }
  const candidate = body as Record<string, unknown>;
  if (
    typeof candidate.username !== "string" ||
    typeof candidate.password !== "string"
  ) {
    throw new AppError(422, "VALIDATION_FAILED", "Format login tidak valid.");
  }
  return {
    username: candidate.username,
    password: candidate.password,
  };
}

async function runLogin<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof InvalidLoginError) {
      throw new AppError(401, "AUTHENTICATION_REQUIRED", error.message);
    }
    if (error instanceof LoginRateLimitedError) {
      throw new AppError(429, "RATE_LIMITED", error.message, {
        retryAfterSeconds: error.retryAfterSeconds,
      });
    }
    if (error instanceof PasswordBusyError) {
      throw new AppError(
        503,
        "SERVICE_BUSY",
        "Layanan login sedang sibuk. Coba lagi.",
        { retryAfterSeconds: error.retryAfterSeconds },
      );
    }
    throw error;
  }
}

function loginResponse(result: Awaited<ReturnType<AuthLoginService["login"]>>) {
  return {
    user: result.user,
    csrfToken: result.session.csrfSecret,
    expiresAt: result.session.session.absoluteExpiresAt,
  };
}
