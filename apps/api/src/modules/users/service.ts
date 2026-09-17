import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import {
  assertActorContext,
  assertMutationContext,
  type UseCaseContext,
} from "../../application/actor-context";
import {
  type CreateUserInput,
  normalizeUsername,
  toUserView,
  type UpdateUserInput,
  UserNotFoundError,
  type UserView,
  validateDisplayName,
  validatePasswordHash,
  validateUserRole,
} from "./domain";
import type { UserRepository } from "./repository";

export class UserApplicationService {
  constructor(private readonly repository: UserRepository) {}

  async getUser(context: UseCaseContext, id: Id): Promise<UserView | null> {
    assertActorContext(context.actor);
    const user = await this.repository.findById(id);
    return user ? toUserView(user) : null;
  }

  async createUser(
    context: UseCaseContext,
    input: CreateUserInput,
  ): Promise<UserView> {
    assertMutationContext(context);
    normalizeUsername(input.username);
    const normalized: CreateUserInput = {
      username: input.username.normalize("NFKC").trim(),
      displayName: validateDisplayName(input.displayName),
      role: input.role,
      passwordHash: validatePasswordHash(input.passwordHash),
      ...(input.forcePasswordChange === undefined
        ? {}
        : { forcePasswordChange: input.forcePasswordChange }),
    };
    validateUserRole(normalized.role);
    return toUserView(await this.repository.create(normalized));
  }

  async updateUser(
    context: UseCaseContext,
    id: Id,
    input: UpdateUserInput,
    expectedUpdatedAt?: UtcTimestamp,
  ): Promise<UserView> {
    assertMutationContext(context);
    const update: UpdateUserInput = {
      ...(input.displayName === undefined
        ? {}
        : { displayName: validateDisplayName(input.displayName) }),
      ...(input.role === undefined ? {} : { role: input.role }),
      ...(input.forcePasswordChange === undefined
        ? {}
        : { forcePasswordChange: input.forcePasswordChange }),
    };
    if (update.role !== undefined) validateUserRole(update.role);
    const user = await this.repository.update(id, update, expectedUpdatedAt);
    if (!user) throw new UserNotFoundError();
    return toUserView(user);
  }

  async disableUser(
    context: UseCaseContext,
    id: Id,
    expectedUpdatedAt?: UtcTimestamp,
  ): Promise<UserView> {
    assertMutationContext(context);
    const user = await this.repository.disable(id, expectedUpdatedAt);
    if (!user) throw new UserNotFoundError();
    return toUserView(user);
  }
}
