import { describe, expect, test } from "bun:test";
import type { Id } from "@gezycbt/contracts";
import type { UseCaseContext } from "../../application/actor-context";
import type { MediaAsset, MediaStorage } from "./domain";
import {
  MediaAssetReferencedError,
  MediaPublishedReferenceError,
  type MediaRelation,
  MediaRelationImmutableError,
  type MediaRelationRepository,
  type MediaRevisionTarget,
  type MediaUsage,
  validateMediaAttachment,
} from "./relation-domain";
import { MediaRelationService } from "./relation-service";

const CONTEXT: UseCaseContext = {
  actor: {
    actorType: "HUMAN",
    userId: "10" as Id,
    role: "TEACHER",
    active: true,
    requestId: "media-relation-request-001",
  },
  idempotencyKey: "media-relation-idempotency-001",
};

describe("media relation policy", () => {
  test("requires informative alt text and explicit decorative semantics", () => {
    expect(() =>
      validateMediaAttachment({
        ...input(),
        altText: null,
        isDecorative: false,
      }),
    ).toThrowError(expect.objectContaining({ code: "ALT_REQUIRED" }));
    expect(() =>
      validateMediaAttachment({
        ...input(),
        altText: "A diagram",
        isDecorative: true,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "DECORATIVE_ALT_FORBIDDEN" }),
    );
    expect(
      validateMediaAttachment({
        ...input(),
        altText: "  A diagram  ",
        isDecorative: false,
      }).altText,
    ).toBe("A diagram");
    expect(
      validateMediaAttachment({
        ...input(),
        altText: null,
        isDecorative: true,
      }).altText,
    ).toBeNull();
  });

  test("attaches only to an authorized draft and records normalized alt text", async () => {
    const repository = new FakeRepository();
    const authorization = new FakeAuthorization();
    const service = new MediaRelationService(
      repository,
      authorization,
      new FakeStorage(),
    );

    const result = await service.attach(CONTEXT, {
      ...input(),
      altText: "  Diagram  ",
      isDecorative: false,
    });

    expect(result.altText).toBe("Diagram");
    expect(repository.attached).toEqual([{ ...input(), altText: "Diagram" }]);
    expect(authorization.resources).toEqual([
      expect.objectContaining({
        ownerTeacherId: "10" as Id,
        subjectId: "20" as Id,
      }),
      { ownerTeacherId: "10" as Id },
    ]);
  });

  test("lists media only after revision scope authorization", async () => {
    const repository = new FakeRepository();
    repository.listed = [
      {
        ...input(),
        altText: "Diagram",
      },
    ];
    const authorization = new FakeAuthorization();
    const service = new MediaRelationService(
      repository,
      authorization,
      new FakeStorage(),
    );

    const result = await service.list(CONTEXT, "40" as Id);

    expect(result).toEqual(repository.listed);
    expect(authorization.resources).toHaveLength(1);
  });

  test("rejects published revision changes and does not call the repository mutation", async () => {
    const repository = new FakeRepository();
    repository.target = { ...repository.target, status: "PUBLISHED" };
    const service = new MediaRelationService(
      repository,
      new FakeAuthorization(),
      new FakeStorage(),
    );

    await expect(service.attach(CONTEXT, input())).rejects.toBeInstanceOf(
      MediaRelationImmutableError,
    );
    expect(repository.attached).toHaveLength(0);
  });

  test("deletes an orphan asset and removes its storage object", async () => {
    const storage = new FakeStorage();
    const repository = new FakeRepository();
    const service = new MediaRelationService(
      repository,
      new FakeAuthorization(),
      storage,
    );

    await service.deleteAsset(CONTEXT, "30" as Id);

    expect(repository.deleted).toEqual(["30" as Id]);
    expect(storage.removed).toEqual(["media/random-key"]);
  });

  test("does not delete an asset referenced by a published revision", async () => {
    const repository = new FakeRepository();
    repository.deleteError = new MediaPublishedReferenceError();
    const service = new MediaRelationService(
      repository,
      new FakeAuthorization(),
      new FakeStorage(),
    );

    await expect(
      service.deleteAsset(CONTEXT, "30" as Id),
    ).rejects.toBeInstanceOf(MediaPublishedReferenceError);
  });

  test("does not delete an asset that is still referenced by a draft", async () => {
    const repository = new FakeRepository();
    repository.deleteError = new MediaAssetReferencedError();
    const service = new MediaRelationService(
      repository,
      new FakeAuthorization(),
      new FakeStorage(),
    );

    await expect(
      service.deleteAsset(CONTEXT, "30" as Id),
    ).rejects.toBeInstanceOf(MediaAssetReferencedError);
  });
});

function input() {
  return {
    questionRevisionId: "40" as Id,
    mediaAssetId: "30" as Id,
    usage: "STIMULUS" as MediaUsage,
    altText: "Diagram",
    isDecorative: false,
  } as const;
}

class FakeAuthorization {
  readonly resources: Array<{ ownerTeacherId: Id; subjectId?: Id }> = [];

  async assertTeacherScope(
    _actor: UseCaseContext["actor"],
    resource: { ownerTeacherId?: Id; subjectId?: Id },
  ): Promise<void> {
    this.resources.push(resource as { ownerTeacherId: Id; subjectId?: Id });
  }
}

class FakeStorage implements Pick<MediaStorage, "remove"> {
  readonly removed: string[] = [];

  async remove(storageKey: string): Promise<void> {
    this.removed.push(storageKey);
  }
}

class FakeRepository implements MediaRelationRepository {
  target: MediaRevisionTarget = {
    id: "40" as Id,
    status: "DRAFT",
    ownerTeacherId: "10" as Id,
    subjectId: "20" as Id,
    questionBankId: "21" as Id,
    questionBankName: "Bank",
  };
  asset: MediaAsset = {
    id: "30" as Id,
    storageKey: "media/random-key",
    originalName: "diagram.png",
    mimeType: "image/png",
    byteSize: 100,
    sha256: new Uint8Array(32),
    width: 100,
    height: 100,
    status: "READY",
    createdBy: "10" as Id,
  };
  readonly attached: MediaRelation[] = [];
  listed: readonly MediaRelation[] = [];
  readonly deleted: Id[] = [];
  deleteError: Error | undefined;

  async findRevisionTarget(): Promise<MediaRevisionTarget> {
    return this.target;
  }

  async findAsset(): Promise<MediaAsset> {
    return this.asset;
  }

  async attach(value: MediaRelation): Promise<MediaRelation> {
    this.attached.push(value);
    return value;
  }

  async list(): Promise<readonly MediaRelation[]> {
    return this.listed;
  }

  async detach(): Promise<boolean> {
    return true;
  }

  async deleteAsset(id: Id): Promise<MediaAsset> {
    this.deleted.push(id);
    if (this.deleteError) throw this.deleteError;
    return { ...this.asset, status: "DELETED" };
  }
}
