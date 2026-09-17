import { describe, expect, test } from "bun:test";
import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import type { UseCaseContext } from "../../application/actor-context";
import type { QuestionBankSummary, QuestionDraft } from "./domain";
import { QuestionImmutableError } from "./domain";
import { QuestionPublishBlockedError, QuestionPublishService } from "./publish";
import type { QuestionPublishRepository } from "./repository";

const NOW = "2026-09-17T00:00:00.000Z" as UtcTimestamp;
const ACTOR: UseCaseContext = {
  actor: {
    actorType: "HUMAN",
    userId: "10" as Id,
    role: "TEACHER",
    active: true,
    requestId: "publish-request-001",
  },
  idempotencyKey: "publish-idempotency-001",
};

describe("QuestionPublishService", () => {
  test("publishes a ready draft with the expected version", async () => {
    const repository = new FakePublishRepository(readyRevision());
    const authorization = new FakeAuthorization();
    const service = new QuestionPublishService(repository, authorization);
    const result = await service.publish(ACTOR, repository.revision.id, NOW);

    expect(result.status).toBe("PUBLISHED");
    expect(result.publishedAt).toBe(NOW);
    expect(repository.expectedUpdatedAt).toBe(NOW);
    expect(authorization.resources).toEqual([
      repository.revision.questionBank.id,
    ]);
  });

  test("blocks publish when readiness has errors", async () => {
    const repository = new FakePublishRepository({
      ...readyRevision(),
      options: [],
    });
    const service = new QuestionPublishService(
      repository,
      new FakeAuthorization(),
    );
    const error = await service
      .publish(ACTOR, repository.revision.id, NOW)
      .catch((value) => value);
    expect(error).toBeInstanceOf(QuestionPublishBlockedError);
    expect(
      (error as QuestionPublishBlockedError).report.errorCount,
    ).toBeGreaterThan(0);
    expect(repository.publishCalls).toBe(0);
  });

  test("never republishes an immutable revision or accepts an unversioned request", async () => {
    const repository = new FakePublishRepository({
      ...readyRevision(),
      status: "PUBLISHED",
      publishedAt: NOW,
    });
    const service = new QuestionPublishService(
      repository,
      new FakeAuthorization(),
    );
    await expect(
      service.publish(ACTOR, repository.revision.id, NOW),
    ).rejects.toBeInstanceOf(QuestionImmutableError);
    const draftRepository = new FakePublishRepository(readyRevision());
    const draftService = new QuestionPublishService(
      draftRepository,
      new FakeAuthorization(),
    );
    await expect(
      draftService.publish(ACTOR, draftRepository.revision.id),
    ).rejects.toThrow("expectedUpdatedAt");
  });
});

function readyRevision(): QuestionDraft {
  const bank: QuestionBankSummary = {
    id: "20" as Id,
    subjectId: "30" as Id,
    ownerTeacherId: "10" as Id,
    name: "Bank",
    status: "ACTIVE",
  };
  return {
    id: "40" as Id,
    questionId: "41" as Id,
    questionBank: bank,
    questionStatus: "ACTIVE",
    revisionNo: 1,
    status: "DRAFT",
    type: "SINGLE_CHOICE",
    stimulusHtml: "Stimulus",
    promptHtml: "Prompt",
    explanationHtml: "Explanation",
    options: [
      { id: "50" as Id, position: 1, contentHtml: "A", isCorrect: true },
      { id: "51" as Id, position: 2, contentHtml: "B", isCorrect: false },
    ],
    statements: [],
    contentHash: new Uint8Array(32),
    publishedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

class FakeAuthorization {
  readonly resources: Id[] = [];

  async assertTeacherScope(
    _actor: UseCaseContext["actor"],
    resource: QuestionBankSummary,
  ): Promise<void> {
    this.resources.push(resource.id);
  }
}

class FakePublishRepository implements QuestionPublishRepository {
  expectedUpdatedAt: UtcTimestamp | undefined;
  publishCalls = 0;

  constructor(public revision: QuestionDraft) {}

  async findQuestionBank(): Promise<QuestionBankSummary | null> {
    return this.revision.questionBank;
  }

  async findRevision(): Promise<QuestionDraft | null> {
    return this.revision;
  }

  async createDraft(): Promise<QuestionDraft> {
    return this.revision;
  }

  async updateDraft(): Promise<QuestionDraft> {
    return this.revision;
  }

  async createDraftRevision(): Promise<QuestionDraft> {
    return this.revision;
  }

  async publishRevision(
    _id: Id,
    expectedUpdatedAt?: UtcTimestamp,
  ): Promise<QuestionDraft> {
    this.publishCalls += 1;
    this.expectedUpdatedAt = expectedUpdatedAt;
    this.revision = {
      ...this.revision,
      status: "PUBLISHED",
      publishedAt: NOW,
    };
    return this.revision;
  }
}
