import { Elysia } from "elysia";
import { AppError } from "../../http/app-error";
import {
  type AuthSession,
  type AuthSessionService,
  readAuthCookie,
} from "./session";

export const CSRF_HEADER_NAME = "x-csrf-token";
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export type CsrfFailureReason =
  | "ORIGIN_MISSING"
  | "ORIGIN_INVALID"
  | "ORIGIN_MISMATCH"
  | "SESSION_REQUIRED"
  | "TOKEN_MISSING"
  | "TOKEN_INVALID";

export class CsrfProtectionError extends Error {
  readonly status: 401 | 403;

  constructor(
    readonly reason: CsrfFailureReason,
    status: 401 | 403,
  ) {
    super("CSRF protection rejected the request");
    this.name = "CsrfProtectionError";
    this.status = status;
  }
}

export interface CsrfRequestInput {
  readonly method: string;
  readonly origin: string | null;
  readonly expectedOrigin: URL | string;
  readonly csrfToken?: string | null;
  readonly session?: AuthSession | null;
  readonly requireSession?: boolean;
  readonly verifyCsrfSecret?: (
    sessionId: AuthSession["id"],
    csrfToken: string,
  ) => Promise<boolean>;
}

export async function assertCsrfRequest(
  input: CsrfRequestInput,
): Promise<void> {
  if (!isStateChangingMethod(input.method)) return;
  assertSameOrigin(input.origin, input.expectedOrigin);
  if (input.requireSession === false) return;
  if (!input.session || !input.verifyCsrfSecret) {
    throw new CsrfProtectionError("SESSION_REQUIRED", 401);
  }
  const token = input.csrfToken?.trim();
  if (!token) throw new CsrfProtectionError("TOKEN_MISSING", 403);
  if (
    token !== input.csrfToken ||
    !(await input.verifyCsrfSecret(input.session.id, token))
  ) {
    throw new CsrfProtectionError("TOKEN_INVALID", 403);
  }
}

export function isStateChangingMethod(method: string): boolean {
  return MUTATION_METHODS.has(method.toUpperCase());
}

export function assertSameOrigin(
  origin: string | null,
  expectedOrigin: URL | string,
): void {
  if (!origin) throw new CsrfProtectionError("ORIGIN_MISSING", 403);
  let actual: URL;
  let expected: URL;
  try {
    actual = new URL(origin);
    expected = new URL(expectedOrigin);
  } catch {
    throw new CsrfProtectionError("ORIGIN_INVALID", 403);
  }
  if (
    actual.origin !== expected.origin ||
    actual.username ||
    actual.password ||
    actual.pathname !== "/" ||
    actual.search ||
    actual.hash
  ) {
    throw new CsrfProtectionError("ORIGIN_MISMATCH", 403);
  }
}

export interface CsrfGuardOptions {
  readonly expectedOrigin: URL | string;
  readonly sessionService: Pick<
    AuthSessionService,
    "resolve" | "verifyCsrfSecret"
  >;
  readonly requireSession?: boolean;
}

/**
 * Mount this plugin on authenticated route groups. Public login routes should
 * use `requireSession: false`, which still enforces same-origin requests.
 */
export function createCsrfGuard(options: CsrfGuardOptions): Elysia {
  return new Elysia({ name: "gezycbt-csrf-guard" }).onBeforeHandle(
    async ({ request }) => {
      if (!isStateChangingMethod(request.method)) return;
      const cookieToken = readAuthCookie(request.headers.get("cookie"));
      const session = cookieToken
        ? await options.sessionService.resolve(cookieToken)
        : null;
      try {
        await assertCsrfRequest({
          method: request.method,
          origin: request.headers.get("origin"),
          expectedOrigin: options.expectedOrigin,
          csrfToken: request.headers.get(CSRF_HEADER_NAME),
          session,
          verifyCsrfSecret: (sessionId, csrfToken) =>
            options.sessionService.verifyCsrfSecret(sessionId, csrfToken),
          ...(options.requireSession === undefined
            ? {}
            : { requireSession: options.requireSession }),
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
    },
  );
}
