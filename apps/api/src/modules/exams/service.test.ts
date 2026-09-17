import { describe, expect, test } from "bun:test";
import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import type { UseCaseContext } from "../../application/actor-context";
import {
  type AddExamQuestionInput,
  type ExamDraftMetadata,
  ExamImmutableError,
  ExamQuestionDuplicateError,
  ExamQuestionNotFoundError,
  ExamQuestionOrderError,
  type ExamQuestionReference,
  type ExamRevision,
  type ExamSummary,
  ExamValidationError,
  ExamVersionConflictError,
  type UpdateExamRevisionInput,
} from "./domain";
import type { ExamDraftRepository } from "./repository";
import { ExamDraftService } from "./service";

const NOW = "2026-09-17T02:00:00.000Z" as UtcTimestamp;
const NEXT = "2026-09-17T02:00:01.000Z" as UtcTimestamp;
const TEACHER = "10" as Id;
const SUBJECT = "20" as Id;
const OTHER_SUBJECT = "21" as Id;

const ACTOR: UseCaseContext = {
  actor: {
    actorType: "HUMAN",
    userId: TEACHER,
    role: "TEACHER",
    active: true,
    requestId: "exam-request-001",
  },
  idempotencyKey: "exam-idempotency-001",
};

describe("ExamDraftService", () => {
  test("creates a draft exam only after owner and subject scope check", async () => {
    const repository = new FakeExamRepository();
    const authorization = new FakeAuthorization();
    const service = new ExamDraftService(repository, authorization);

    const result = await service.createExam(ACTOR, {
      subjectId: SUBJECT,
      ownerTeacherId: TEACHER,
      title: "Ujian Matematika",
      instructionsHtml: "Kerjakan dengan teliti",
      durationSeconds: 3_600,
      shuffleQuestions: true,
      shuffleOptions: false,
    });

    expect(result.status).toBe("DRAFT");
    expect(result.exam.subjectId).toBe(SUBJECT);
    expect(result.totalPoints).toBe("0.00");
    expect(authorization.resources).toEqual([
      { ownerTeacherId: TEACHER, subjectId: SUBJECT },
    ]);
  });

  test("rejects invalid metadata before persistence", async () => {
    const repository = new FakeExamRepository();
    const service = new ExamDraftService(repository, new FakeAuthorization());

    await expect(
      service.createExam(ACTOR, {
        subjectId: SUBJECT,
        ownerTeacherId: TEACHER,
        title: " ",
        instructionsHtml: "",
        durationSeconds: 60,
        shuffleQuestions: false,
        shuffleOptions: false,
      }),
    ).rejects.toBeInstanceOf(ExamValidationError);
    expect(repository.createCalls).toBe(0);
  });

  test("adds published questions with normalized points and prevents duplicates", async () => {
    const repository = new FakeExamRepository();
    const authorization = new FakeAuthorization();
    const service = new ExamDraftService(repository, authorization);

    const added = await service.addQuestion(
      ACTOR,
      repository.revision.id,
      { questionRevisionId: "100" as Id, points: "2.5", position: 1 },
      NOW,
    );

    expect(added.questions[0]?.questionRevisionId).toBe("100" as Id);
    expect(added.questions[0]?.points).toBe("2.50");
    expect(authorization.resources).toHaveLength(2);
    expect(repository.expectedVersions).toEqual([NOW]);

    await expect(
      service.addQuestion(
        ACTOR,
        repository.revision.id,
        { questionRevisionId: "100" as Id, points: "1.00" },
        NEXT,
      ),
    ).rejects.toBeInstanceOf(ExamQuestionDuplicateError);
  });

  test("rejects unpublished and cross-subject question revisions", async () => {
    const repository = new FakeExamRepository();
    const service = new ExamDraftService(repository, new FakeAuthorization());
    repository.question = {
      ...repository.question,
      status: "DRAFT",
    };
    await expect(
      service.addQuestion(
        ACTOR,
        repository.revision.id,
        { questionRevisionId: repository.question.id, points: "1" },
        NOW,
      ),
    ).rejects.toBeInstanceOf(ExamQuestionNotFoundError);

    repository.question = {
      ...repository.question,
      status: "PUBLISHED",
      subjectId: OTHER_SUBJECT,
    };
    await expect(
      service.addQuestion(
        ACTOR,
        repository.revision.id,
        { questionRevisionId: repository.question.id, points: "1" },
        NOW,
      ),
    ).rejects.toBeInstanceOf(ExamQuestionNotFoundError);
    expect(repository.addCalls).toBe(0);
  });

  test("removes a question and reorders the remaining list", async () => {
    const repository = new FakeExamRepository();
    repository.revision = withQuestions([
      question("100", 1),
      question("101", 2),
      question("102", 3),
    ]);
    const service = new ExamDraftService(repository, new FakeAuthorization());

    const removed = await service.removeQuestion(
      ACTOR,
      repository.revision.id,
      "101" as Id,
      NOW,
    );
    expect(removed.questions.map((item) => item.questionRevisionId)).toEqual([
      "100" as Id,
      "102" as Id,
    ]);
    expect(removed.questions.map((item) => item.position)).toEqual([1, 2]);

    const reordered = await service.reorderQuestions(
      ACTOR,
      repository.revision.id,
      ["102", "100"] as Id[],
      NEXT,
    );
    expect(reordered.questions.map((item) => item.questionRevisionId)).toEqual([
      "102" as Id,
      "100" as Id,
    ]);
  });

  test("rejects incomplete reorder and stale optimistic version", async () => {
    const repository = new FakeExamRepository();
    repository.revision = withQuestions([
      question("100", 1),
      question("101", 2),
    ]);
    const service = new ExamDraftService(repository, new FakeAuthorization());

    await expect(
      service.reorderQuestions(
        ACTOR,
        repository.revision.id,
        ["100"] as Id[],
        NOW,
      ),
    ).rejects.toBeInstanceOf(ExamQuestionOrderError);
    await expect(
      service.updateRevision(
        ACTOR,
        repository.revision.id,
        { title: "Baru" },
        NEXT,
      ),
    ).rejects.toBeInstanceOf(ExamVersionConflictError);
    expect(repository.updateCalls).toBe(0);
  });

  test("does not mutate a published revision", async () => {
    const repository = new FakeExamRepository();
    repository.revision = { ...repository.revision, status: "PUBLISHED" };
    const service = new ExamDraftService(repository, new FakeAuthorization());

    await expect(
      service.updateRevision(
        ACTOR,
        repository.revision.id,
        { title: "Tidak boleh" },
        NOW,
      ),
    ).rejects.toBeInstanceOf(ExamImmutableError);
    await expect(
      service.addQuestion(
        ACTOR,
        repository.revision.id,
        { questionRevisionId: "100" as Id, points: "1" },
        NOW,
      ),
    ).rejects.toBeInstanceOf(ExamImmutableError);
  });
});

function question(id: string, position: number) {
  return {
    id: `${position + 500}` as Id,
    examRevisionId: "40" as Id,
    questionRevisionId: id as Id,
    position,
    points: "1.00",
    createdAt: NOW,
  };
}

function withQuestions(
  questions: readonly ExamRevision["questions"][number][],
): ExamRevision {
  return {
    ...new FakeExamRepository().revision,
    questions,
  };
}

class FakeAuthorization {
  readonly resources: Array<{
    ownerTeacherId?: Id;
    subjectId?: Id;
  }> = [];

  async assertTeacherScope(
    _actor: UseCaseContext["actor"],
    resource: { ownerTeacherId?: Id; subjectId?: Id },
  ): Promise<void> {
    this.resources.push(resource);
  }
}

class FakeExamRepository implements ExamDraftRepository {
  revision: ExamRevision = makeRevision();
  question: ExamQuestionReference = {
    id: "100" as Id,
    questionId: "1000" as Id,
    subjectId: SUBJECT,
    ownerTeacherId: TEACHER,
    status: "PUBLISHED",
  };
  createCalls = 0;
  addCalls = 0;
  updateCalls = 0;
  expectedVersions: UtcTimestamp[] = [];

  async findExam(): Promise<ExamSummary> {
    return this.revision.exam;
  }

  async findRevision(): Promise<ExamRevision> {
    return this.revision;
  }

  async findLatestRevision(): Promise<ExamRevision> {
    return this.revision;
  }

  async findQuestionRevision(): Promise<ExamQuestionReference> {
    return this.question;
  }

  async createExam(): Promise<ExamRevision> {
    this.createCalls += 1;
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
    input: UpdateExamRevisionInput,
    expectedUpdatedAt: UtcTimestamp,
  ): Promise<ExamRevision> {
    if (expectedUpdatedAt !== this.revision.updatedAt)
      throw new ExamVersionConflictError();
    this.updateCalls += 1;
    this.expectedVersions.push(expectedUpdatedAt);
    this.revision = {
      ...this.revision,
      ...input,
      updatedAt: NEXT,
    };
    return this.revision;
  }

  async publishRevision(
    _id: Id,
    expectedUpdatedAt: UtcTimestamp,
    totalPoints: string,
  ): Promise<ExamRevision> {
    if (expectedUpdatedAt !== this.revision.updatedAt)
      throw new Error("stale revision");
    this.revision = {
      ...this.revision,
      status: "PUBLISHED",
      totalPoints,
      publishedAt: NEXT,
      exam: {
        ...this.revision.exam,
        status: "PUBLISHED",
        currentPublishedRevisionId: this.revision.id,
      },
    };
    return this.revision;
  }

  async addQuestion(
    _id: Id,
    input: AddExamQuestionInput,
    expectedUpdatedAt: UtcTimestamp,
  ): Promise<ExamRevision> {
    if (expectedUpdatedAt !== this.revision.updatedAt)
      throw new ExamVersionConflictError();
    this.addCalls += 1;
    this.expectedVersions.push(expectedUpdatedAt);
    if (
      this.revision.questions.some(
        (item) => item.questionRevisionId === input.questionRevisionId,
      )
    )
      throw new ExamQuestionDuplicateError();
    const position = input.position ?? this.revision.questions.length + 1;
    const questions = [
      ...this.revision.questions.map((item) =>
        item.position >= position
          ? { ...item, position: item.position + 1 }
          : item,
      ),
      {
        id: "999" as Id,
        examRevisionId: this.revision.id,
        questionRevisionId: input.questionRevisionId,
        position,
        points: input.points,
        createdAt: NOW,
      },
    ].sort((a, b) => a.position - b.position);
    this.revision = { ...this.revision, questions, updatedAt: NEXT };
    return this.revision;
  }

  async removeQuestion(
    _id: Id,
    questionRevisionId: Id,
    expectedUpdatedAt: UtcTimestamp,
  ): Promise<ExamRevision | null> {
    if (expectedUpdatedAt !== this.revision.updatedAt)
      throw new ExamVersionConflictError();
    this.expectedVersions.push(expectedUpdatedAt);
    const remaining = this.revision.questions
      .filter((item) => item.questionRevisionId !== questionRevisionId)
      .map((item, index) => ({ ...item, position: index + 1 }));
    this.revision = { ...this.revision, questions: remaining, updatedAt: NEXT };
    return this.revision;
  }

  async reorderQuestions(
    _id: Id,
    ids: readonly Id[],
    expectedUpdatedAt: UtcTimestamp,
  ): Promise<ExamRevision> {
    if (expectedUpdatedAt !== this.revision.updatedAt)
      throw new ExamVersionConflictError();
    this.expectedVersions.push(expectedUpdatedAt);
    const byId = new Map(
      this.revision.questions.map((item) => [item.questionRevisionId, item]),
    );
    this.revision = {
      ...this.revision,
      questions: ids.map((id, index) => {
        const item = byId.get(id);
        if (!item) throw new Error("Fake question is missing");
        return { ...item, position: index + 1 };
      }),
      updatedAt: NEXT,
    };
    return this.revision;
  }
}

function makeRevision(): ExamRevision {
  const exam: ExamSummary = {
    id: "30" as Id,
    subjectId: SUBJECT,
    ownerTeacherId: TEACHER,
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
    instructionsHtml: "",
    durationSeconds: 3_600,
    shuffleQuestions: false,
    shuffleOptions: false,
    totalPoints: "0.00",
    publishedAt: null,
    questions: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}
