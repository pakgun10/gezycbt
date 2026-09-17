import type { Id } from "@gezycbt/contracts";
import {
  assertActorContext,
  assertMutationContext,
  type UseCaseContext,
} from "../../application/actor-context";
import type { AuthorizationPolicyService } from "../../application/authorization";
import { MediaPersistenceError, type MediaStorage } from "./domain";
import {
  type AttachMediaInput,
  type MediaRelation,
  MediaRelationImmutableError,
  MediaRelationNotFoundError,
  type MediaRelationRepository,
  validateMediaAttachment,
} from "./relation-domain";

export class MediaRelationService {
  constructor(
    private readonly repository: MediaRelationRepository,
    private readonly authorization: Pick<
      AuthorizationPolicyService,
      "assertTeacherScope"
    >,
    private readonly storage: Pick<MediaStorage, "remove">,
  ) {}

  async list(
    context: UseCaseContext,
    questionRevisionId: Id,
  ): Promise<readonly MediaRelation[]> {
    assertActorContext(context.actor);
    const target = await this.repository.findRevisionTarget(questionRevisionId);
    if (!target) throw new MediaRelationNotFoundError();
    await this.authorization.assertTeacherScope(context.actor, target);
    return this.repository.list(questionRevisionId);
  }

  async attach(
    context: UseCaseContext,
    input: AttachMediaInput,
  ): Promise<MediaRelation> {
    assertMutationContext(context);
    const normalized = validateMediaAttachment(input);
    const target = await this.repository.findRevisionTarget(
      normalized.questionRevisionId,
    );
    if (!target) throw new MediaRelationNotFoundError();
    await this.authorization.assertTeacherScope(context.actor, target);
    if (target.status !== "DRAFT") throw new MediaRelationImmutableError();
    const asset = await this.repository.findAsset(normalized.mediaAssetId);
    if (!asset || asset.status !== "READY")
      throw new MediaRelationNotFoundError("Media asset is not available");
    await this.authorization.assertTeacherScope(context.actor, {
      ownerTeacherId: asset.createdBy,
    });
    return this.repository.attach(normalized);
  }

  async detach(
    context: UseCaseContext,
    questionRevisionId: Id,
    mediaAssetId: Id,
  ): Promise<void> {
    assertMutationContext(context);
    const target = await this.repository.findRevisionTarget(questionRevisionId);
    if (!target) throw new MediaRelationNotFoundError();
    await this.authorization.assertTeacherScope(context.actor, target);
    if (target.status !== "DRAFT") throw new MediaRelationImmutableError();
    const detached = await this.repository.detach(
      questionRevisionId,
      mediaAssetId,
    );
    if (!detached)
      throw new MediaRelationNotFoundError("Media relation was not found");
  }

  async deleteAsset(context: UseCaseContext, mediaAssetId: Id): Promise<void> {
    assertMutationContext(context);
    const asset = await this.repository.findAsset(mediaAssetId);
    if (!asset)
      throw new MediaRelationNotFoundError("Media asset was not found");
    await this.authorization.assertTeacherScope(context.actor, {
      ownerTeacherId: asset.createdBy,
    });
    const deleted = await this.repository.deleteAsset(mediaAssetId);
    if (!deleted)
      throw new MediaRelationNotFoundError("Media asset was not found");
    try {
      await this.storage.remove(deleted.storageKey);
    } catch {
      throw new MediaPersistenceError(
        "Media metadata was deleted but file cleanup failed",
      );
    }
  }
}
