import { describe, expect, test } from "bun:test";
import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import type { UseCaseContext } from "../../application/actor-context";
import {
  type QuestionBankSummary,
  type QuestionDraft,
  type QuestionDraftContent,
  QuestionForeignReferenceError,
  QuestionValidationError,
} from "./domain";
import type { QuestionDraftRepository } from "./repository";
import { hashQuestionContent, QuestionDraftService } from "./service";

const ACTOR: UseCaseContext = {
  actor: {
    actorType: "HUMAN",
    userId: "10" as Id,
    role: "TEACHER",
    active: true,
    requestId: "request-question-001",
  },
  idempotencyKey: "question-idempotency-001",
};

describe("QuestionDraftService", () => {
  test("creates a typed draft after checking bank scope", async () => {
    const repository = new FakeQuestionRepository();
    const authorization = new FakeAuthorization();
    const service = new QuestionDraftService(repository, authorization);
    const result = await service.createDraft(ACTOR, {
      questionBankId: "20" as Id,
      type: "SINGLE_CHOICE",
      stimulusHtml: "<p>Stimulus</p>",
      promptHtml: "<p>Pilih</p>",
      explanationHtml: null,
      options: [
        { position: 1, contentHtml: "A", isCorrect: true },
        { position: 2, contentHtml: "B", isCorrect: false },
      ],
      statements: [],
    });

    expect(result.status).toBe("DRAFT");
    expect(result.type).toBe("SINGLE_CHOICE");
    expect(result.options).toHaveLength(2);
    expect(result.contentHash).toHaveLength(32);
    expect(authorization.resources).toEqual(["20" as Id]);
  });

  test("rejects child IDs when creating a new draft", async () => {
    const service = new QuestionDraftService(
      new FakeQuestionRepository(),
      new FakeAuthorization(),
    );
    await expect(
      service.createDraft(ACTOR, {
        ...choiceContent(),
        questionBankId: "20" as Id,
        options: [
          {
            id: "999" as Id,
            position: 1,
            contentHtml: "A",
            isCorrect: false,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(QuestionForeignReferenceError);
  });

  test("rejects children belonging to the wrong type", async () => {
    const service = new QuestionDraftService(
      new FakeQuestionRepository(),
      new FakeAuthorization(),
    );
    await expect(
      service.createDraft(ACTOR, {
        questionBankId: "20" as Id,
        type: "TRUE_FALSE",
        stimulusHtml: "Stimulus",
        promptHtml: null,
        explanationHtml: null,
        options: [{ position: 1, contentHtml: "A", isCorrect: false }],
        statements: [],
      }),
    ).rejects.toBeInstanceOf(QuestionValidationError);
  });

  test("edits a published revision by creating a new draft revision", async () => {
    const repository = new FakeQuestionRepository();
    repository.revision = {
      ...repository.revision,
      status: "PUBLISHED",
      publishedAt: NOW,
    };
    const service = new QuestionDraftService(
      repository,
      new FakeAuthorization(),
    );
    const sourceId = repository.revision.id;
    const publishedSource = repository.revision;
    const result = await service.updateDraft(
      ACTOR,
      sourceId,
      choiceContent(),
      NOW,
    );
    expect(result.status).toBe("DRAFT");
    expect(result.revisionNo).toBe(2);
    expect(result.id).not.toBe(sourceId);
    expect(publishedSource.status).toBe("PUBLISHED");
    expect(repository.createdFromPublished).toBe(true);
  });

  test("authorizes before rejecting an archived bank", async () => {
    const repository = new FakeQuestionRepository();
    repository.bank = { ...repository.bank, status: "ARCHIVED" };
    const authorization = new FakeAuthorization();
    const service = new QuestionDraftService(repository, authorization);

    await expect(
      service.createDraft(ACTOR, {
        ...choiceContent(),
        questionBankId: repository.bank.id,
      }),
    ).rejects.toBeInstanceOf(QuestionValidationError);
    expect(authorization.resources).toEqual([repository.bank.id]);
  });

  test("hash is independent of child array order", async () => {
    const content = choiceContent();
    const reversed = {
      ...content,
      options: [...content.options].reverse(),
    };
    expect(await hashQuestionContent(content)).toEqual(
      await hashQuestionContent(reversed),
    );
  });
});

const NOW = "2026-09-17T00:00:00.000Z" as UtcTimestamp;

function choiceContent(): QuestionDraftContent {
  return {
    type: "SINGLE_CHOICE",
    stimulusHtml: "Stimulus",
    promptHtml: "Prompt",
    explanationHtml: null,
    options: [
      { position: 1, contentHtml: "A", isCorrect: true },
      { position: 2, contentHtml: "B", isCorrect: false },
    ],
    statements: [],
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

class FakeQuestionRepository implements QuestionDraftRepository {
  bank: QuestionBankSummary = {
    id: "20" as Id,
    subjectId: "30" as Id,
    ownerTeacherId: "10" as Id,
    name: "Bank",
    status: "ACTIVE",
  };
  revision: QuestionDraft = {
    id: "40" as Id,
    questionId: "41" as Id,
    questionBank: this.bank,
    questionStatus: "ACTIVE",
    revisionNo: 1,
    status: "DRAFT",
    ...choiceContent(),
    contentHash: new Uint8Array(32),
    publishedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };

  async findQuestionBank(): Promise<QuestionBankSummary> {
    return this.bank;
  }

  async findRevision(): Promise<QuestionDraft> {
    return this.revision;
  }

  async createDraft(
    input: Parameters<QuestionDraftRepository["createDraft"]>[0],
  ): Promise<QuestionDraft> {
    this.revision = {
      ...this.revision,
      ...input,
      id: "40" as Id,
      questionId: "41" as Id,
      questionBank: this.bank,
      questionStatus: "ACTIVE",
      revisionNo: 1,
      status: "DRAFT",
      publishedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    };
    return this.revision;
  }

  async updateDraft(): Promise<QuestionDraft> {
    return this.revision;
  }

  createdFromPublished = false;

  async createDraftRevision(
    _sourceRevisionId: Id,
    input: QuestionDraftContent & { readonly contentHash: Uint8Array },
    _expectedUpdatedAt?: UtcTimestamp,
  ): Promise<QuestionDraft> {
    this.createdFromPublished = true;
    const source = this.revision;
    this.revision = {
      ...source,
      ...input,
      id: "42" as Id,
      revisionNo: source.revisionNo + 1,
      status: "DRAFT",
      publishedAt: null,
    };
    return this.revision;
  }
}
