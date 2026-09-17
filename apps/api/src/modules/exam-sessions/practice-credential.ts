import type { Id } from "@gezycbt/contracts";

export const PRACTICE_COOKIE_NAME = "__Host-gezycbt-practice";
export const PRACTICE_COOKIE_MAX_AGE_SECONDS = 24 * 60 * 60;

export interface PracticeCredential {
  readonly token: string;
  readonly sessionId: Id;
  readonly cookie: string;
  readonly digest: Uint8Array;
}

/** Guest practice credential: raw token is returned once and never persisted. */
export async function createPracticeCredential(
  sessionId: Id,
  token = opaqueToken(),
): Promise<PracticeCredential> {
  if (!/^\d+$/u.test(sessionId) || !/^[A-Za-z0-9_-]{32,64}$/u.test(token))
    throw new TypeError("Practice credential input is invalid");
  return {
    token,
    sessionId,
    digest: await digestPracticeCredential(token),
    cookie: serializePracticeCookie(token),
  };
}

export async function digestPracticeCredential(
  token: string,
): Promise<Uint8Array> {
  if (!/^[A-Za-z0-9_-]{32,64}$/u.test(token))
    throw new TypeError("Practice credential is invalid");
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
  );
}

export function readPracticeCredential(
  cookieHeader: string | null,
): string | null {
  if (!cookieHeader) return null;
  for (const pair of cookieHeader.split(";")) {
    const [name, ...value] = pair.trim().split("=");
    if (
      name === PRACTICE_COOKIE_NAME &&
      value.length > 0 &&
      /^[A-Za-z0-9_-]{32,64}$/u.test(value.join("="))
    )
      return value.join("=");
  }
  return null;
}

export function serializePracticeCookie(token: string): string {
  if (!/^[A-Za-z0-9_-]{32,64}$/u.test(token))
    throw new TypeError("Practice credential is invalid");
  return `${PRACTICE_COOKIE_NAME}=${token}; Path=/; Max-Age=${PRACTICE_COOKIE_MAX_AGE_SECONDS}; Secure; HttpOnly; SameSite=Strict`;
}

function opaqueToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}
