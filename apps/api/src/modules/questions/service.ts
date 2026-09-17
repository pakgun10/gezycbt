import type { Id } from "@gezycbt/contracts";
import {
  assertActorContext,
  assertMutationContext,
  type UseCaseContext,
} from "../../application/actor-context";
import type { AuthorizationPolicyService } from "../../application/authorization";
import {
  type CreateQuestionDraftInput,
  type QuestionDraft,
  type QuestionDraftContent,
  QuestionForeignReferenceError,
  QuestionImmutableError,
  QuestionNotFoundError,
  QuestionValidationError,
  validateQuestionContent,
} from "./domain";
import type { QuestionDraftRepository } from "./repository";

export class QuestionDraftService {
  constructor(
    private readonly repository: QuestionDraftRepository,
    private readonly authorization: Pick<
      AuthorizationPolicyService,
      "assertTeacherScope"
    >,
  ) {}

  async createDraft(
    context: UseCaseContext,
    input: CreateQuestionDraftInput,
  ): Promise<QuestionDraft> {
    assertMutationContext(context);
    const content = validateQuestionContent(input);
    assertNewChildren(content);
    const bank = await this.repository.findQuestionBank(input.questionBankId);
    if (!bank) throw new QuestionNotFoundError();
    // Authorize before exposing whether a bank is archived to an out-of-scope
    // teacher. The authorization policy owns the not-found/forbidden boundary.
    await this.authorization.assertTeacherScope(context.actor, bank);
    if (bank.status !== "ACTIVE")
      throw new QuestionValidationError(
        "Archived question bank cannot receive new questions",
      );
    const createdBy = context.actor.userId;
    if (!createdBy) throw new QuestionNotFoundError();
    return this.repository.createDraft({
      ...content,
      questionBankId: bank.id,
      createdBy,
      contentHash: await hashQuestionContent(content),
    });
  }

  async getDraft(
    context: UseCaseContext,
    revisionId: Id,
  ): Promise<QuestionDraft> {
    assertActorContext(context.actor);
    const revision = await this.repository.findRevision(revisionId);
    if (!revision) throw new QuestionNotFoundError();
    await this.authorization.assertTeacherScope(
      context.actor,
      revision.questionBank,
    );
    return revision;
  }

  async updateDraft(
    context: UseCaseContext,
    revisionId: Id,
    input: QuestionDraftContent,
    expectedUpdatedAt?: QuestionDraft["updatedAt"],
  ): Promise<QuestionDraft> {
    assertMutationContext(context);
    const current = await this.repository.findRevision(revisionId);
    if (!current) throw new QuestionNotFoundError();
    await this.authorization.assertTeacherScope(
      context.actor,
      current.questionBank,
    );
    if (current.status !== "DRAFT") throw new QuestionImmutableError();
    const content = validateQuestionContent(input);
    const updated = await this.repository.updateDraft(
      revisionId,
      { ...content, contentHash: await hashQuestionContent(content) },
      expectedUpdatedAt,
    );
    if (!updated) throw new QuestionNotFoundError();
    return updated;
  }
}

function assertNewChildren(content: QuestionDraftContent): void {
  if (
    content.options.some((option) => option.id !== undefined) ||
    content.statements.some((statement) => statement.id !== undefined)
  ) {
    throw new QuestionForeignReferenceError();
  }
}

export async function hashQuestionContent(
  content: QuestionDraftContent,
): Promise<Uint8Array> {
  const canonical = JSON.stringify({
    type: content.type,
    stimulusHtml: content.stimulusHtml,
    promptHtml: content.promptHtml,
    explanationHtml: content.explanationHtml,
    options: [...content.options]
      .sort((a, b) => a.position - b.position)
      .map((option) => ({
        position: option.position,
        contentHtml: option.contentHtml,
        isCorrect: option.isCorrect,
      })),
    statements: [...content.statements]
      .sort((a, b) => a.position - b.position)
      .map((statement) => ({
        position: statement.position,
        statementHtml: statement.statementHtml,
        correctValue: statement.correctValue,
      })),
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return new Uint8Array(digest);
}
