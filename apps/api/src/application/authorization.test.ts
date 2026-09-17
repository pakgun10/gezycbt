import { describe, expect, test } from "bun:test";
import type { Id } from "@gezycbt/contracts";
import type { ActorContext, ActorRole } from "./actor-context";
import {
  AuthorizationDeniedError,
  AuthorizationPolicyService,
  AuthorizationRequiredError,
} from "./authorization";

const teacherId = "10" as Id;
const otherTeacherId = "11" as Id;
const participantId = "20" as Id;
const otherParticipantId = "21" as Id;

const actor = (
  role: ActorContext["role"],
  userId = teacherId,
): ActorContext => ({
  actorType: "HUMAN",
  userId: userId as Id,
  requestId: "request-1",
  ...(role ? { role } : {}),
});

function policies() {
  return new AuthorizationPolicyService(async (id) =>
    id === teacherId
      ? { subjectIds: ["30" as Id], classIds: ["40" as Id, "41" as Id] }
      : null,
  );
}

describe("resource authorization policies", () => {
  test("requires a verified active human role for privileged policies", () => {
    expect(() =>
      policies().assertAdmin({ actorType: "SYSTEM", requestId: "r" }),
    ).toThrow(AuthorizationRequiredError);
    expect(() => policies().assertAdmin(actor("TEACHER"))).toThrow(
      AuthorizationDeniedError,
    );
    expect(() =>
      policies().assertAdmin({
        ...actor("ADMIN"),
        role: "SUPERADMIN" as unknown as ActorRole,
      }),
    ).toThrow(AuthorizationRequiredError);
    expect(() =>
      policies().assertAdmin({ ...actor("ADMIN"), active: false }),
    ).toThrow(AuthorizationRequiredError);
  });

  test("admin bypasses teacher scope while teacher needs ownership and assigned scope", async () => {
    const policy = policies();
    await expect(
      policy.assertTeacherScope(actor("ADMIN"), {
        ownerTeacherId: otherTeacherId,
        subjectId: "999" as Id,
        classIds: ["999" as Id],
      }),
    ).resolves.toBeUndefined();
    await expect(
      policy.assertTeacherScope(actor("TEACHER"), {
        ownerTeacherId: otherTeacherId,
        subjectId: "30" as Id,
      }),
    ).rejects.toMatchObject({ policy: "TEACHER_OWNS_RESOURCE" });
    await expect(
      policy.assertTeacherScope(actor("TEACHER"), {
        ownerTeacherId: teacherId,
        subjectId: "999" as Id,
      }),
    ).rejects.toMatchObject({ policy: "TEACHER_SCOPE" });
    await expect(
      policy.assertTeacherScope(actor("TEACHER"), {
        ownerTeacherId: teacherId,
        subjectId: "30" as Id,
        classIds: ["40" as Id],
      }),
    ).resolves.toBeUndefined();
    await expect(
      policy.assertTeacherCanReadResource(actor("TEACHER"), {
        ownerTeacherId: otherTeacherId,
        subjectId: "30" as Id,
      }),
    ).resolves.toBeUndefined();
    await expect(
      policy.assertTeacherCanReadResource(actor("TEACHER"), {
        ownerTeacherId: otherTeacherId,
        subjectId: "999" as Id,
      }),
    ).rejects.toMatchObject({ policy: "TEACHER_SCOPE" });
    await expect(
      policy.assertTeacherAssignedScope(actor("TEACHER"), {
        subjectId: "30" as Id,
        classId: "41" as Id,
      }),
    ).resolves.toBeUndefined();
    await expect(
      policy.assertTeacherAssignedScope(actor("TEACHER"), {
        subjectId: "999" as Id,
      }),
    ).rejects.toMatchObject({ policy: "TEACHER_SCOPE" });
  });

  test("participant eligibility requires own ID and explicit or class target", async () => {
    const policy = policies();
    const resource = {
      participantId,
      targetParticipantIds: [],
      targetClassIds: ["40" as Id],
      participantClassIds: ["40" as Id],
    };
    await expect(
      policy.assertParticipantEligible(
        actor("PARTICIPANT", participantId),
        resource,
      ),
    ).resolves.toBeUndefined();
    await expect(
      policy.assertParticipantEligible(
        actor("PARTICIPANT", otherParticipantId),
        resource,
      ),
    ).rejects.toMatchObject({ policy: "PARTICIPANT_ELIGIBLE" });
    await expect(
      policy.assertParticipantEligible(actor("PARTICIPANT", participantId), {
        ...resource,
        participantClassIds: ["99" as Id],
      }),
    ).rejects.toMatchObject({ policy: "PARTICIPANT_ELIGIBLE" });
    await expect(
      policy.assertParticipantEligible(
        actor("TEACHER", participantId),
        resource,
      ),
    ).rejects.toMatchObject({ policy: "PARTICIPANT_ELIGIBLE" });
  });

  test("session and result access cannot cross participant IDs or release boundary", async () => {
    const policy = policies();
    const session = {
      participantId,
      schedule: { ownerTeacherId: teacherId, subjectId: "30" as Id },
    };
    await expect(
      policy.assertCanReadSession(actor("PARTICIPANT", participantId), session),
    ).resolves.toBeUndefined();
    await expect(
      policy.assertCanReadSession(
        actor("PARTICIPANT", otherParticipantId),
        session,
      ),
    ).rejects.toMatchObject({ policy: "EXAM_SESSION_OWNER" });
    await expect(
      policy.assertCanReadSession(actor("TEACHER"), session),
    ).resolves.toBeUndefined();
    await expect(
      policy.assertResultVisible(actor("PARTICIPANT", participantId), {
        ...session,
        releasedAt: null,
      }),
    ).rejects.toMatchObject({ policy: "RESULT_VISIBLE" });
    await expect(
      policy.assertResultVisible(actor("PARTICIPANT", participantId), {
        ...session,
        releasedAt: "2026-09-17T00:00:00.000Z",
      }),
    ).resolves.toBeUndefined();
    await expect(
      policy.assertExamSessionOwner(actor("PARTICIPANT", participantId), {
        ...session,
        participantId: null,
        practiceCredentialValid: true,
      }),
    ).resolves.toBeUndefined();
  });
});
