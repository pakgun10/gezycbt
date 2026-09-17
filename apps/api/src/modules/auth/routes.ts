import type { Id } from "@gezycbt/contracts";
import { Elysia } from "elysia";
import { AppError } from "../../http/app-error";
import type { UserRole } from "../users/domain";
import {
  assertCsrfRequest,
  CSRF_HEADER_NAME,
  CsrfProtectionError,
} from "./csrf";
import {
  type AuthLoginService,
  InvalidLoginError,
  LoginRateLimitedError,
} from "./login";
import { PasswordBusyError } from "./password";
import {
  AUTH_COOKIE_NAME,
  type AuthSessionService,
  readAuthCookie,
} from "./session";

export interface AuthCurrentUser {
  readonly id: Id;
  readonly username: string;
  readonly displayName: string;
  readonly role: UserRole;
  readonly forcePasswordChange: boolean;
}

export interface AuthRoutesOptions {
  readonly loginService: AuthLoginService;
  readonly sessionService: Pick<
    AuthSessionService,
    "resolve" | "verifyCsrfSecret"
  > & {
    readonly rotate?: AuthSessionService["rotate"];
    readonly logout?: AuthSessionService["logout"];
  };
  readonly currentUser?: (userId: Id) => Promise<AuthCurrentUser | null>;
  readonly expectedOrigin: URL | string;
  /** Resolve the peer/proxy address only from a trusted server adapter. */
  readonly getClientIp?: (request: Request) => string | undefined;
}

export function createAuthRoutes(options: AuthRoutesOptions) {
  return registerAuthRoutes(
    new Elysia({ name: "gezycbt-auth-routes" }),
    options,
  );
}

/** Registers authentication routes directly on the host application. */
export function registerAuthRoutes(
  app: Elysia,
  options: AuthRoutesOptions,
): Elysia {
  return app
    .post("/api/v1/auth/staff/login", async ({ body, request, set }) => {
      await assertAuthMutation(request, options);
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
      await assertAuthMutation(request, options);
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
    })
    .post("/api/v1/auth/logout", async ({ request, set }) => {
      const token = readAuthCookie(request.headers.get("cookie"));
      if (token) await assertAuthMutation(request, options);
      if (token && options.sessionService.logout) {
        await options.sessionService.logout(token);
      }
      set.headers["set-cookie"] =
        `${AUTH_COOKIE_NAME}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`;
      return { data: { loggedOut: true } };
    })
    .get("/api/v1/auth/me", async ({ request, set }) => {
      const token = readAuthCookie(request.headers.get("cookie"));
      if (!token || !options.sessionService.rotate)
        throw new AppError(
          401,
          "AUTH_SESSION_EXPIRED",
          "Sesi login tidak tersedia.",
        );
      const result = await options.sessionService.rotate(token);
      if (!result)
        throw new AppError(
          401,
          "AUTH_SESSION_EXPIRED",
          "Sesi login telah berakhir.",
        );
      const user = options.currentUser
        ? await options.currentUser(result.session.userId)
        : {
            id: result.session.userId,
            username: String(result.session.userId),
            displayName: "Peserta",
            role: result.session.role,
            forcePasswordChange: false,
          };
      if (!user)
        throw new AppError(
          401,
          "AUTH_SESSION_EXPIRED",
          "Sesi login tidak tersedia.",
        );
      set.headers["set-cookie"] = result.cookie;
      return {
        user,
        csrfToken: result.csrfSecret,
        expiresAt: result.session.absoluteExpiresAt,
      };
    }) as unknown as Elysia;
}

async function assertAuthMutation(
  request: Request,
  options: AuthRoutesOptions,
): Promise<void> {
  const token = readAuthCookie(request.headers.get("cookie"));
  const session = token ? await options.sessionService.resolve(token) : null;
  try {
    await assertCsrfRequest({
      method: request.method,
      origin: request.headers.get("origin"),
      expectedOrigin: options.expectedOrigin,
      csrfToken: request.headers.get(CSRF_HEADER_NAME),
      session,
      verifyCsrfSecret: (sessionId, csrfToken) =>
        options.sessionService.verifyCsrfSecret(sessionId, csrfToken),
      requireSession: false,
    });
  } catch (error) {
    if (error instanceof CsrfProtectionError) {
      throw new AppError(
        error.status,
        error.status === 401 ? "AUTHENTICATION_REQUIRED" : "CSRF_INVALID",
        error.status === 401
          ? "Autentikasi diperlukan."
          : "Permintaan tidak dapat diverifikasi.",
        { reason: error.reason },
      );
    }
    throw error;
  }
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
