import { describe, expect, test } from "bun:test";
import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import type { UseCaseContext } from "../../application/actor-context";
import {
  type AddExamQuestionInput,
  type CreateExamInput,
  type ExamDraftMetadata,
  ExamImmutableError,
  type ExamQuestionReference,
  type ExamRevision,
  type ExamSummary,
  type UpdateExamRevisionInput,
} from "./domain";
import { ExamPublishBlockedError, ExamPublishService } from "./publish";
import type { ExamDraftRepository } from "./repository";

const NOW = "2026-09-17T02:00:00.000Z" as UtcTimestamp;
const NEXT = "2026-09-17T02:00:01.000Z" as UtcTimestamp;
const ACTOR: UseCaseContext = {
  actor: {
    actorType: "HUMAN",
    userId: "10" as Id,
    role: "TEACHER",
    active: true,
    requestId: "exam-publish-request-001",
  },
  idempotencyKey: "exam-publish-idempotency-001",
};

describe("ExamPublishService", () => {
  test("publishes a ready revision with the deterministic total", async () => {
    const repository = new FakePublishRepository(readyRevision());
    const authorization = new FakeAuthorization();
    const service = new ExamPublishService(repository, authorization);

    const result = await service.publish(ACTOR, repository.revision.id, NOW);

    expect(result.status).toBe("PUBLISHED");
    expect(result.totalPoints).toBe("3.50");
    expect(repository.publishedTotal).toBe("3.50");
    expect(repository.publishedExpectedVersion).toBe(NOW);
    expect(authorization.resources).toEqual([repository.revision.exam]);
  });

  test("blocks publish and returns field-addressable readiness report", async () => {
    const repository = new FakePublishRepository({
      ...readyRevision(),
      questions: [],
    });
    const service = new ExamPublishService(repository, new FakeAuthorization());

    const error = await service
      .publish(ACTOR, repository.revision.id, NOW)
      .catch((value) => value);
    expect(error).toBeInstanceOf(ExamPublishBlockedError);
    expect(
      (error as ExamPublishBlockedError).report.errorCount,
    ).toBeGreaterThan(0);
    expect(repository.publishCalls).toBe(0);
  });

  test("requires expected version and never republishes an immutable revision", async () => {
    const repository = new FakePublishRepository(readyRevision());
    const service = new ExamPublishService(repository, new FakeAuthorization());
    await expect(
      service.publish(ACTOR, repository.revision.id),
    ).rejects.toThrow("expectedUpdatedAt");

    repository.revision = { ...repository.revision, status: "PUBLISHED" };
    await expect(
      service.publish(ACTOR, repository.revision.id, NOW),
    ).rejects.toBeInstanceOf(ExamImmutableError);
    expect(repository.publishCalls).toBe(0);
  });
});

class FakeAuthorization {
  readonly resources: ExamSummary[] = [];

  async assertTeacherScope(
    _actor: UseCaseContext["actor"],
    resource: ExamSummary,
  ): Promise<void> {
    this.resources.push(resource);
  }
}

class FakePublishRepository implements ExamDraftRepository {
  publishedTotal: string | undefined;
  publishedExpectedVersion: UtcTimestamp | undefined;
  publishCalls = 0;

  constructor(
    public revision: ExamRevision,
    public question: ExamQuestionReference = publishedQuestion("100"),
  ) {}

  async findExam(): Promise<ExamSummary> {
    return this.revision.exam;
  }

  async findRevision(): Promise<ExamRevision> {
    return this.revision;
  }

  async findLatestRevision(): Promise<ExamRevision> {
    return this.revision;
  }

  async findQuestionRevision(id: Id): Promise<ExamQuestionReference | null> {
    return id === this.question.id ? this.question : publishedQuestion(id);
  }

  async createExam(_input: CreateExamInput): Promise<ExamRevision> {
    return this.revision;
  }

  async createDraftRevision(
    _examId: Id,
    _input: ExamDraftMetadata,
  ): Promise<ExamRevision> {
    return this.revision;
  }

  async updateRevision(
    _id: Id,
    _input: UpdateExamRevisionInput,
    _expectedUpdatedAt: UtcTimestamp,
  ): Promise<ExamRevision> {
    return this.revision;
  }

  async publishRevision(
    _id: Id,
    expectedUpdatedAt: UtcTimestamp,
    totalPoints: string,
  ): Promise<ExamRevision> {
    this.publishCalls += 1;
    this.publishedExpectedVersion = expectedUpdatedAt;
    this.publishedTotal = totalPoints;
    this.revision = {
      ...this.revision,
      status: "PUBLISHED",
      totalPoints,
      publishedAt: NEXT,
    };
    return this.revision;
  }

  async addQuestion(
    _id: Id,
    _input: AddExamQuestionInput,
    _expectedUpdatedAt: UtcTimestamp,
  ): Promise<ExamRevision> {
    return this.revision;
  }

  async removeQuestion(
    _id: Id,
    _questionRevisionId: Id,
    _expectedUpdatedAt: UtcTimestamp,
  ): Promise<ExamRevision> {
    return this.revision;
  }

  async reorderQuestions(
    _id: Id,
    _orderedQuestionRevisionIds: readonly Id[],
    _expectedUpdatedAt: UtcTimestamp,
  ): Promise<ExamRevision> {
    return this.revision;
  }
}

function publishedQuestion(id: string): ExamQuestionReference {
  return {
    id: id as Id,
    questionId: `${id}0` as Id,
    subjectId: "20" as Id,
    ownerTeacherId: "10" as Id,
    status: "PUBLISHED",
  };
}

function readyRevision(): ExamRevision {
  const exam: ExamSummary = {
    id: "30" as Id,
    subjectId: "20" as Id,
    ownerTeacherId: "10" as Id,
    status: "DRAFT",
    currentPublishedRevisionId: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
  return {
    id: "40" as Id,
    examId: exam.id,
    exam,
    revisionNo: 1,
    status: "DRAFT",
    title: "Ujian",
    instructionsHtml: "Kerjakan",
    durationSeconds: 3_600,
    shuffleQuestions: false,
    shuffleOptions: false,
    totalPoints: "0.00",
    publishedAt: null,
    questions: [
      {
        id: "50" as Id,
        examRevisionId: "40" as Id,
        questionRevisionId: "100" as Id,
        position: 1,
        points: "1.50",
        createdAt: NOW,
      },
      {
        id: "51" as Id,
        examRevisionId: "40" as Id,
        questionRevisionId: "101" as Id,
        position: 2,
        points: "2.00",
        createdAt: NOW,
      },
    ],
    createdAt: NOW,
    updatedAt: NOW,
  };
}
