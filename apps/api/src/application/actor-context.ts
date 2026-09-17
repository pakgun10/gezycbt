import type { Id } from "@gezycbt/contracts";

export type ActorType = "HUMAN" | "EXTERNAL_AGENT" | "SYSTEM" | "RECOVERY";
export type ActorRole = "ADMIN" | "TEACHER" | "PARTICIPANT";

export interface ActorContext {
  readonly actorType: ActorType;
  readonly userId?: Id;
  /** Role is supplied by the verified auth/session adapter, never by input. */
  readonly role?: ActorRole;
  /** Session middleware may set this false when the user was disabled. */
  readonly active?: boolean;
  readonly integrationClientId?: Id;
  readonly requestId: string;
}

export interface UseCaseContext {
  readonly actor: ActorContext;
  readonly idempotencyKey?: string;
}

export function assertActorContext(context: ActorContext): void {
  if (!context.requestId || context.requestId.length > 128)
    throw new Error("Actor request ID is invalid");
  if (context.actorType === "EXTERNAL_AGENT" && !context.integrationClientId) {
    throw new Error("External agent actor requires an integration client");
  }
  if (context.actorType === "HUMAN" && !context.userId)
    throw new Error("Human actor requires a user");
  if (
    context.actorType === "SYSTEM" &&
    (context.userId || context.integrationClientId)
  ) {
    throw new Error("System actor cannot impersonate another actor");
  }
}

export function assertMutationContext(context: UseCaseContext): void {
  assertActorContext(context.actor);
  if (
    !context.idempotencyKey ||
    context.idempotencyKey.length < 16 ||
    context.idempotencyKey.length > 128
  ) {
    throw new Error("Mutation requires a bounded idempotency key");
  }
}
