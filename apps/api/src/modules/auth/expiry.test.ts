import { describe, expect, test } from "bun:test";
import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import type { ActorContext } from "../../application/actor-context";
import { AuthorizationRequiredError } from "../../application/authorization";
import {
  AuthSessionExpiredError,
  assertParticipantResumeOwnership,
  createParticipantReloginContext,
  isParticipantReloginContextValid,
  requireAuthSession,
} from "./expiry";
import type { AuthSession } from "./session";

const NOW = new Date("2026-09-17T00:00:00.000Z");
const SESSION: AuthSession = {
  id: "9" as Id,
  userId: "20" as Id,
  role: "PARTICIPANT",
  createdAt: "2026-09-17T00:00:00.000Z" as UtcTimestamp,
  lastSeenAt: "2026-09-17T00:00:00.000Z" as UtcTimestamp,
  idleExpiresAt: "2026-09-18T00:00:00.000Z" as UtcTimestamp,
  absoluteExpiresAt: "2026-09-18T00:00:00.000Z" as UtcTimestamp,
  revokedAt: null,
  revokeReason: null,
};

describe("auth expiry and participant re-login contract", () => {
  test("missing cookie is authentication required while stale cookie is session expired", async () => {
    const sessions = { resolve: async () => null };
    await expect(
      requireAuthSession(
        new Request("https://cbt.test/peserta/ujian/9"),
        sessions,
      ),
    ).rejects.toBeInstanceOf(AuthorizationRequiredError);
    await expect(
      requireAuthSession(
        new Request("https://cbt.test/peserta/ujian/9", {
          headers: {
            cookie: `__Host-gezycbt-auth=${"a".repeat(43)}`,
          },
        }),
        sessions,
      ),
    ).rejects.toBeInstanceOf(AuthSessionExpiredError);
  });

  test("active cookie resolves without changing the exam session", async () => {
    const sessions = { resolve: async () => SESSION };
    await expect(
      requireAuthSession(
        new Request("https://cbt.test/peserta/ujian/9", {
          headers: { cookie: `__Host-gezycbt-auth=${"a".repeat(43)}` },
        }),
        sessions,
      ),
    ).resolves.toEqual(SESSION);
  });

  test("resume context is opaque, short lived, and route-bound", () => {
    const context = createParticipantReloginContext("9" as Id, NOW);
    expect(context.contextToken).toMatch(/^[A-Za-z0-9_-]{22}$/u);
    expect(context.returnPath).toBe("/peserta/ujian/9");
    expect(
      isParticipantReloginContextValid(
        context,
        "9" as Id,
        new Date("2026-09-17T00:29:59.000Z"),
      ),
    ).toBe(true);
    expect(
      isParticipantReloginContextValid(
        context,
        "10" as Id,
        new Date("2026-09-17T00:01:00.000Z"),
      ),
    ).toBe(false);
    expect(
      isParticipantReloginContextValid(
        context,
        "9" as Id,
        new Date("2026-09-17T00:30:00.000Z"),
      ),
    ).toBe(false);
  });

  test("resume still requires the authenticated participant to own the exam session", () => {
    const participant = {
      actorType: "HUMAN",
      userId: "20" as Id,
      role: "PARTICIPANT",
      requestId: "resume-1",
    } satisfies ActorContext;
    expect(() =>
      assertParticipantResumeOwnership(participant, "20" as Id),
    ).not.toThrow();
    expect(() =>
      assertParticipantResumeOwnership(participant, "21" as Id),
    ).toThrow(AuthorizationRequiredError);
    expect(() =>
      assertParticipantResumeOwnership(
        { ...participant, active: false },
        "20" as Id,
      ),
    ).toThrow(AuthorizationRequiredError);
  });
});
