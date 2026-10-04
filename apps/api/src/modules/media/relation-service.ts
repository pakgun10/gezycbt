import type { Id, UtcTimestamp } from "@gezycbt/contracts";
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
    // Keep optional placement defaults inside the SQL adapter so existing
    // repository adapters remain compatible while the policy still validates
    // the complete input before authorization and mutation.
    const relation = await this.repository.attach({
      ...input,
      altText: normalized.altText,
      ...(input.placementKey === undefined
        ? {}
        : { placementKey: input.placementKey }),
    });
    await this.repository.refreshRevisionHash?.(normalized.questionRevisionId);
    return relation;
  }

  async detach(
    context: UseCaseContext,
    questionRevisionId: Id,
    mediaAssetId: Id,
    expectedUpdatedAt?: UtcTimestamp,
  ): Promise<void> {
    assertMutationContext(context);
    const target = await this.repository.findRevisionTarget(questionRevisionId);
    if (!target) throw new MediaRelationNotFoundError();
    await this.authorization.assertTeacherScope(context.actor, target);
    if (target.status !== "DRAFT") throw new MediaRelationImmutableError();
    const detached = await this.repository.detach(
      questionRevisionId,
      mediaAssetId,
      expectedUpdatedAt,
    );
    if (!detached)
      throw new MediaRelationNotFoundError("Media relation was not found");
    await this.repository.refreshRevisionHash?.(questionRevisionId);
  }

  async detachByPlacement(
    context: UseCaseContext,
    questionRevisionId: Id,
    placementKey: string,
    expectedUpdatedAt?: UtcTimestamp,
  ): Promise<void> {
    assertMutationContext(context);
    const target = await this.repository.findRevisionTarget(questionRevisionId);
    if (!target) throw new MediaRelationNotFoundError();
    await this.authorization.assertTeacherScope(context.actor, target);
    if (target.status !== "DRAFT") throw new MediaRelationImmutableError();
    if (!this.repository.detachByPlacement)
      throw new MediaRelationNotFoundError("Media placement is not available");
    const detached = await this.repository.detachByPlacement(
      questionRevisionId,
      placementKey,
      expectedUpdatedAt,
    );
    if (!detached)
      throw new MediaRelationNotFoundError("Media placement was not found");
    await this.repository.refreshRevisionHash?.(questionRevisionId);
  }

  async update(
    context: UseCaseContext,
    input: Parameters<NonNullable<MediaRelationRepository["update"]>>[0],
  ): Promise<MediaRelation> {
    assertMutationContext(context);
    const target = await this.repository.findRevisionTarget(
      input.questionRevisionId,
    );
    if (!target) throw new MediaRelationNotFoundError();
    await this.authorization.assertTeacherScope(context.actor, target);
    if (target.status !== "DRAFT") throw new MediaRelationImmutableError();
    if (!this.repository.update)
      throw new MediaRelationNotFoundError("Media placement is not available");
    const updated = await this.repository.update(input);
    if (!updated)
      throw new MediaRelationNotFoundError("Media placement was not found");
    await this.repository.refreshRevisionHash?.(input.questionRevisionId);
    return updated;
  }

  async getAsset(context: UseCaseContext, mediaAssetId: Id) {
    assertActorContext(context.actor);
    const asset = await this.repository.findAsset(mediaAssetId);
    if (!asset)
      throw new MediaRelationNotFoundError("Media asset was not found");
    if (asset.status !== "READY")
      throw new MediaRelationNotFoundError("Media asset was not found");
    await this.authorization.assertTeacherScope(context.actor, {
      ownerTeacherId: asset.createdBy,
    });
    return asset;
  }

  async listOrphans(
    context: UseCaseContext,
  ): Promise<readonly import("./domain").MediaAsset[]> {
    assertActorContext(context.actor);
    const createdBy = context.actor.userId;
    if (!createdBy) return [];
    if (!this.repository.listOrphans) return [];
    return this.repository.listOrphans({ createdBy, limit: 100 });
  }

  async deleteAsset(context: UseCaseContext, mediaAssetId: Id): Promise<void> {
    assertMutationContext(context);
    const asset = await this.repository.findAsset(mediaAssetId);
    if (!asset)
      throw new MediaRelationNotFoundError("Media asset was not found");
    await this.authorization.assertTeacherScope(context.actor, {
      ownerTeacherId: asset.createdBy,
    });
    if (asset.status === "DELETED") return;
    const deleted = await this.repository.deleteAsset(mediaAssetId);
    if (!deleted)
      throw new MediaRelationNotFoundError("Media asset was not found");
    try {
      await this.storage.remove(deleted.storageKey);
    } catch {
      await this.repository.restoreAsset?.(deleted.id);
      throw new MediaPersistenceError(
        "Media file cleanup failed; the asset remains available for retry",
      );
    }
  }
}
