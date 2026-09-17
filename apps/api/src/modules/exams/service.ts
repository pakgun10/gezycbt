import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import {
  assertActorContext,
  assertMutationContext,
  type UseCaseContext,
} from "../../application/actor-context";
import type { AuthorizationPolicyService } from "../../application/authorization";
import {
  type AddExamQuestionInput,
  type CreateExamInput,
  type ExamDraftMetadata,
  ExamImmutableError,
  ExamNotFoundError,
  type ExamQuestion,
  ExamQuestionNotFoundError,
  ExamQuestionOrderError,
  type ExamRevision,
  ExamRevisionNotFoundError,
  type UpdateExamRevisionInput,
  validateAddExamQuestionInput,
  validateCreateExamInput,
  validateUpdateExamRevisionInput,
} from "./domain";
import type { ExamDraftRepository } from "./repository";

export class ExamDraftService {
  constructor(
    private readonly repository: ExamDraftRepository,
    private readonly authorization: Pick<
      AuthorizationPolicyService,
      "assertTeacherScope"
    >,
  ) {}

  async createExam(
    context: UseCaseContext,
    input: CreateExamInput,
  ): Promise<ExamRevision> {
    assertMutationContext(context);
    const normalized = validateCreateExamInput(input);
    await this.authorization.assertTeacherScope(context.actor, {
      ownerTeacherId: normalized.ownerTeacherId,
      subjectId: normalized.subjectId,
    });
    return this.repository.createExam(normalized);
  }

  async getExam(
    context: UseCaseContext,
    examId: Id,
  ): Promise<ExamRevision | null> {
    assertActorContext(context.actor);
    const exam = await this.repository.findExam(examId);
    if (!exam) return null;
    await this.authorization.assertTeacherScope(context.actor, exam);
    const revisionId = exam.currentPublishedRevisionId;
    return revisionId
      ? this.repository.findRevision(revisionId)
      : this.repository.findLatestRevision(exam.id);
  }

  async getRevision(
    context: UseCaseContext,
    revisionId: Id,
  ): Promise<ExamRevision> {
    assertActorContext(context.actor);
    const revision = await this.repository.findRevision(revisionId);
    if (!revision) throw new ExamRevisionNotFoundError();
    await this.authorization.assertTeacherScope(context.actor, revision.exam);
    return revision;
  }

  async createDraftRevision(
    context: UseCaseContext,
    examId: Id,
    input: ExamDraftMetadata,
  ): Promise<ExamRevision> {
    assertMutationContext(context);
    const exam = await this.repository.findExam(examId);
    if (!exam) throw new ExamNotFoundError();
    await this.authorization.assertTeacherScope(context.actor, exam);
    const normalized = validateCreateExamInput({
      ...input,
      subjectId: exam.subjectId,
      ownerTeacherId: exam.ownerTeacherId,
    });
    const revision = await this.repository.createDraftRevision(examId, {
      title: normalized.title,
      instructionsHtml: normalized.instructionsHtml,
      durationSeconds: normalized.durationSeconds,
      shuffleQuestions: normalized.shuffleQuestions,
      shuffleOptions: normalized.shuffleOptions,
    });
    if (!revision) throw new ExamNotFoundError();
    return revision;
  }

  async updateRevision(
    context: UseCaseContext,
    revisionId: Id,
    input: UpdateExamRevisionInput,
    expectedUpdatedAt: UtcTimestamp,
  ): Promise<ExamRevision> {
    assertMutationContext(context);
    const revision = await this.repository.findRevision(revisionId);
    if (!revision) throw new ExamRevisionNotFoundError();
    await this.authorization.assertTeacherScope(context.actor, revision.exam);
    if (revision.status !== "DRAFT") throw new ExamImmutableError();
    const normalized = validateUpdateExamRevisionInput(input);
    const updated = await this.repository.updateRevision(
      revisionId,
      normalized,
      expectedUpdatedAt,
    );
    if (!updated) throw new ExamRevisionNotFoundError();
    return updated;
  }

  async addQuestion(
    context: UseCaseContext,
    revisionId: Id,
    input: AddExamQuestionInput,
    expectedUpdatedAt: UtcTimestamp,
  ): Promise<ExamRevision> {
    assertMutationContext(context);
    const revision = await this.requireRevisionForMutation(context, revisionId);
    const normalized = validateAddExamQuestionInput(input);
    const question = await this.repository.findQuestionRevision(
      normalized.questionRevisionId,
    );
    if (!question) throw new ExamQuestionNotFoundError();
    await this.authorization.assertTeacherScope(context.actor, question);
    if (question.status !== "PUBLISHED") throw new ExamQuestionNotFoundError();
    if (question.subjectId !== revision.exam.subjectId)
      throw new ExamQuestionNotFoundError();
    const updated = await this.repository.addQuestion(
      revisionId,
      normalized,
      expectedUpdatedAt,
    );
    if (!updated) throw new ExamRevisionNotFoundError();
    return updated;
  }

  async removeQuestion(
    context: UseCaseContext,
    revisionId: Id,
    questionRevisionId: Id,
    expectedUpdatedAt: UtcTimestamp,
  ): Promise<ExamRevision> {
    assertMutationContext(context);
    const revision = await this.requireRevisionForMutation(context, revisionId);
    if (
      !revision.questions.some(
        (question) => question.questionRevisionId === questionRevisionId,
      )
    )
      throw new ExamQuestionNotFoundError();
    const updated = await this.repository.removeQuestion(
      revisionId,
      questionRevisionId,
      expectedUpdatedAt,
    );
    if (!updated) throw new ExamQuestionNotFoundError();
    return updated;
  }

  async reorderQuestions(
    context: UseCaseContext,
    revisionId: Id,
    orderedQuestionRevisionIds: readonly Id[],
    expectedUpdatedAt: UtcTimestamp,
  ): Promise<ExamRevision> {
    assertMutationContext(context);
    const revision = await this.requireRevisionForMutation(context, revisionId);
    const currentIds = revision.questions.map(
      (question) => question.questionRevisionId,
    );
    if (
      orderedQuestionRevisionIds.length !== currentIds.length ||
      new Set(orderedQuestionRevisionIds).size !==
        orderedQuestionRevisionIds.length ||
      orderedQuestionRevisionIds.some((id) => !currentIds.includes(id))
    )
      throw new ExamQuestionOrderError();
    const updated = await this.repository.reorderQuestions(
      revisionId,
      orderedQuestionRevisionIds,
      expectedUpdatedAt,
    );
    if (!updated) throw new ExamRevisionNotFoundError();
    return updated;
  }

  private async requireRevisionForMutation(
    context: UseCaseContext,
    revisionId: Id,
  ): Promise<ExamRevision> {
    const revision = await this.repository.findRevision(revisionId);
    if (!revision) throw new ExamRevisionNotFoundError();
    await this.authorization.assertTeacherScope(context.actor, revision.exam);
    if (revision.status !== "DRAFT") throw new ExamImmutableError();
    return revision;
  }
}

/**
 * Kept as a named helper for route adapters that need to render the selected
 * list without importing persistence details.
 */
export function examQuestionIds(revision: ExamRevision): readonly Id[] {
  return revision.questions.map(
    (question: ExamQuestion) => question.questionRevisionId,
  );
}
