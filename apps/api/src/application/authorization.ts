import type { Id } from "@gezycbt/contracts";
import type { ActorContext, ActorRole } from "./actor-context";

export type TeacherScopeLookup = (teacherId: Id) => Promise<{
  readonly subjectIds: readonly Id[];
  readonly classIds: readonly Id[];
} | null>;

export interface TeacherScopedResource {
  /** Required for owned resources (question bank, exam, schedule). */
  readonly ownerTeacherId?: Id;
  readonly subjectId?: Id;
  readonly classId?: Id;
  readonly classIds?: readonly Id[];
}

export interface ParticipantEligibilityResource {
  readonly participantId: Id;
  readonly targetParticipantIds: readonly Id[];
  readonly targetClassIds: readonly Id[];
  readonly participantClassIds: readonly Id[];
}

export interface ExamSessionResource {
  readonly participantId: Id | null;
  readonly schedule: TeacherScopedResource;
  readonly practiceCredentialValid?: boolean;
}

export interface ResultResource extends ExamSessionResource {
  readonly releasedAt: string | null;
}

export class AuthorizationRequiredError extends Error {
  readonly status = 401 as const;

  constructor() {
    super("Authentication is required");
    this.name = "AuthorizationRequiredError";
  }
}

export class AuthorizationDeniedError extends Error {
  readonly status = 403 as const;

  constructor(readonly policy: AuthorizationPolicy) {
    super("You are not allowed to access this resource");
    this.name = "AuthorizationDeniedError";
  }
}

export type AuthorizationPolicy =
  | "ADMIN_ONLY"
  | "STAFF_ONLY"
  | "TEACHER_SCOPE"
  | "TEACHER_OWNS_RESOURCE"
  | "PARTICIPANT_ELIGIBLE"
  | "EXAM_SESSION_OWNER"
  | "RESULT_VISIBLE";

const ACTOR_ROLES = ["ADMIN", "TEACHER", "PARTICIPANT"] as const;

export class AuthorizationPolicyService {
  constructor(private readonly lookupTeacherScope: TeacherScopeLookup) {}

  assertAdmin(actor: ActorContext): void {
    assertHumanRole(actor, "ADMIN", "ADMIN_ONLY");
  }

  assertStaff(actor: ActorContext): void {
    const role = assertHuman(actor, "STAFF_ONLY");
    if (role !== "ADMIN" && role !== "TEACHER") {
      throw new AuthorizationDeniedError("STAFF_ONLY");
    }
  }

  async assertTeacherScope(
    actor: ActorContext,
    resource: TeacherScopedResource,
  ): Promise<void> {
    const role = assertHuman(actor, "TEACHER_SCOPE");
    if (role === "ADMIN") return;
    if (role !== "TEACHER") {
      throw new AuthorizationDeniedError("TEACHER_SCOPE");
    }
    if (resource.ownerTeacherId !== actor.userId) {
      throw new AuthorizationDeniedError("TEACHER_OWNS_RESOURCE");
    }
    await this.assertTeacherAssignedScope(actor, resource);
  }

  async assertTeacherAssignedScope(
    actor: ActorContext,
    resource: TeacherScopedResource,
  ): Promise<void> {
    const role = assertHuman(actor, "TEACHER_SCOPE");
    if (role === "ADMIN") return;
    if (role !== "TEACHER") {
      throw new AuthorizationDeniedError("TEACHER_SCOPE");
    }
    const userId = actor.userId;
    if (!userId) throw new AuthorizationRequiredError();
    const scope = await this.lookupTeacherScope(userId);
    if (!scope) throw new AuthorizationDeniedError("TEACHER_SCOPE");
    if (
      (resource.subjectId !== undefined &&
        !scope.subjectIds.includes(resource.subjectId)) ||
      (resource.classId !== undefined &&
        !scope.classIds.includes(resource.classId)) ||
      (resource.classIds ?? []).some((id) => !scope.classIds.includes(id))
    ) {
      throw new AuthorizationDeniedError("TEACHER_SCOPE");
    }
  }

  async assertTeacherCanReadResource(
    actor: ActorContext,
    resource: TeacherScopedResource,
  ): Promise<void> {
    const role = assertHuman(actor, "TEACHER_SCOPE");
    if (role === "ADMIN") return;
    if (role !== "TEACHER") {
      throw new AuthorizationDeniedError("TEACHER_SCOPE");
    }
    await this.assertTeacherAssignedScope(actor, resource);
  }

  async assertParticipantEligible(
    actor: ActorContext,
    resource: ParticipantEligibilityResource,
  ): Promise<void> {
    assertHuman(actor, "PARTICIPANT_ELIGIBLE");
    if (
      actor.role !== "PARTICIPANT" ||
      actor.userId !== resource.participantId ||
      (!resource.targetParticipantIds.includes(resource.participantId) &&
        !resource.targetClassIds.some((id) =>
          resource.participantClassIds.includes(id),
        ))
    ) {
      throw new AuthorizationDeniedError("PARTICIPANT_ELIGIBLE");
    }
  }

  async assertExamSessionOwner(
    actor: ActorContext,
    resource: ExamSessionResource,
  ): Promise<void> {
    if (
      resource.practiceCredentialValid === true &&
      resource.participantId === null
    )
      return;
    assertHuman(actor, "EXAM_SESSION_OWNER");
    if (
      actor.role !== "PARTICIPANT" ||
      resource.participantId === null ||
      actor.userId !== resource.participantId
    ) {
      throw new AuthorizationDeniedError("EXAM_SESSION_OWNER");
    }
  }

  async assertCanReadSession(
    actor: ActorContext,
    resource: ExamSessionResource,
  ): Promise<void> {
    if (
      resource.practiceCredentialValid === true &&
      resource.participantId === null
    )
      return;
    assertHuman(actor, "EXAM_SESSION_OWNER");
    if (actor.role === "PARTICIPANT") {
      if (actor.userId !== resource.participantId) {
        throw new AuthorizationDeniedError("EXAM_SESSION_OWNER");
      }
      return;
    }
    await this.assertTeacherCanReadResource(actor, resource.schedule);
  }

  async assertResultVisible(
    actor: ActorContext,
    resource: ResultResource,
  ): Promise<void> {
    if (
      resource.practiceCredentialValid === true &&
      resource.participantId === null
    )
      return;
    assertHuman(actor, "RESULT_VISIBLE");
    if (actor.role === "PARTICIPANT") {
      if (
        actor.userId !== resource.participantId ||
        resource.releasedAt === null
      ) {
        throw new AuthorizationDeniedError("RESULT_VISIBLE");
      }
      return;
    }
    await this.assertTeacherCanReadResource(actor, resource.schedule);
  }
}

function assertHuman(
  actor: ActorContext,
  _policy: AuthorizationPolicy,
): ActorRole {
  if (
    actor.actorType !== "HUMAN" ||
    !actor.userId ||
    !actor.role ||
    !ACTOR_ROLES.includes(actor.role) ||
    actor.active === false
  ) {
    throw new AuthorizationRequiredError();
  }
  return actor.role;
}

function assertHumanRole(
  actor: ActorContext,
  role: ActorRole,
  policy: AuthorizationPolicy,
): void {
  const actual = assertHuman(actor, policy);
  if (actual !== role) throw new AuthorizationDeniedError(policy);
}
