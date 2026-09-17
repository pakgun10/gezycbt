import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import type { ActorContext } from "../../application/actor-context";
import { AuthorizationRequiredError } from "../../application/authorization";
import {
  type AuthSession,
  type AuthSessionService,
  readAuthCookie,
} from "./session";

export class AuthSessionExpiredError extends Error {
  readonly status = 401 as const;
  readonly code = "AUTH_SESSION_EXPIRED" as const;

  constructor() {
    super("Sesi login berakhir.");
    this.name = "AuthSessionExpiredError";
  }
}

export interface AuthSessionResolver
  extends Pick<AuthSessionService, "resolve"> {}

/**
 * Distinguishes a missing cookie from a cookie that was present but expired,
 * revoked, or invalidated by disabling the account. The returned session is
 * still authoritative and must be passed into the actor factory.
 */
export async function requireAuthSession(
  request: Request,
  sessions: AuthSessionResolver,
): Promise<AuthSession> {
  const cookieHeader = request.headers.get("cookie");
  const token = readAuthCookie(cookieHeader);
  if (!token) throw new AuthorizationRequiredError();
  const session = await sessions.resolve(token);
  if (!session) throw new AuthSessionExpiredError();
  return session;
}

export interface ParticipantReloginContext {
  /** Browser-only correlation value; never accepted as authentication. */
  readonly contextToken: string;
  readonly examSessionId: Id;
  readonly returnPath: string;
  readonly createdAt: UtcTimestamp;
  readonly expiresAt: UtcTimestamp;
}

const CONTEXT_BYTES = 16;
const CONTEXT_TTL_MS = 30 * 60 * 1000;
const OPAQUE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,64}$/u;

export function createParticipantReloginContext(
  examSessionId: Id,
  now = new Date(),
): ParticipantReloginContext {
  if (!/^\d+$/u.test(examSessionId)) {
    throw new TypeError("Exam session ID is invalid");
  }
  const createdAt = now.toISOString() as UtcTimestamp;
  const expiresAt = new Date(
    now.getTime() + CONTEXT_TTL_MS,
  ).toISOString() as UtcTimestamp;
  const bytes = new Uint8Array(CONTEXT_BYTES);
  crypto.getRandomValues(bytes);
  return {
    contextToken: Buffer.from(bytes).toString("base64url"),
    examSessionId,
    returnPath: `/peserta/ujian/${examSessionId}`,
    createdAt,
    expiresAt,
  };
}

export function isParticipantReloginContextValid(
  context: ParticipantReloginContext,
  expectedExamSessionId: Id,
  now = new Date(),
): boolean {
  return (
    context.examSessionId === expectedExamSessionId &&
    context.returnPath === `/peserta/ujian/${expectedExamSessionId}` &&
    OPAQUE_TOKEN_PATTERN.test(context.contextToken) &&
    Number.isFinite(Date.parse(context.createdAt)) &&
    Number.isFinite(Date.parse(context.expiresAt)) &&
    Date.parse(context.expiresAt) > now.getTime()
  );
}

export function assertParticipantResumeOwnership(
  actor: ActorContext,
  participantId: Id,
): void {
  if (
    actor.actorType !== "HUMAN" ||
    actor.role !== "PARTICIPANT" ||
    actor.active === false ||
    actor.userId !== participantId
  ) {
    throw new AuthorizationRequiredError();
  }
}
