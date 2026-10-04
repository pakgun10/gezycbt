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
  QuestionNotFoundError,
  QuestionValidationError,
  validateQuestionContent,
} from "./domain";
import type { QuestionDraftRepository } from "./repository";
import { hashCanonicalQuestion } from "./content-hash";
import type { MediaRelation } from "../media/relation-domain";

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
    const created = await this.repository.createDraft({
      ...content,
      questionBankId: bank.id,
      createdBy,
      contentHash: await hashQuestionContent(content),
    });
    return this.withMedia(created);
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
    return this.withMedia(revision);
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
    const content = validateQuestionContent(input);
    // A published revision is cloned into new child rows. Preserve source
    // child IDs long enough for the repository to remap media targets when a
    // teacher reorders options or statements; the repository strips them from
    // the inserted rows.
    if (current.status === "PUBLISHED")
      assertCloneChildReferences(current, content);
    const media = this.repository.listMedia
      ? await this.repository.listMedia(revisionId)
      : [];
    const contentHash = await hashQuestionContent(content, media);
    const updated =
      current.status === "PUBLISHED"
        ? await this.repository.createDraftRevision(
            revisionId,
            { ...content, contentHash },
            expectedUpdatedAt,
          )
        : await this.repository.updateDraft(
            revisionId,
            { ...content, contentHash },
            expectedUpdatedAt,
          );
    if (!updated) throw new QuestionNotFoundError();
    if (current.status === "PUBLISHED" && this.repository.refreshRevisionHash) {
      await this.repository.refreshRevisionHash(updated.id);
      const refreshed = await this.repository.findRevision(updated.id);
      if (refreshed) return this.withMedia(refreshed);
    }
    return this.withMedia(updated);
  }

  private async withMedia(draft: QuestionDraft): Promise<QuestionDraft> {
    if (!this.repository.listMedia) return draft;
    return { ...draft, media: await this.repository.listMedia(draft.id) };
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

function assertCloneChildReferences(
  source: QuestionDraft,
  content: QuestionDraftContent,
): void {
  const sourceOptionIds = new Set(
    source.options.flatMap((option) => (option.id ? [option.id] : [])),
  );
  const sourceStatementIds = new Set(
    source.statements.flatMap((statement) =>
      statement.id ? [statement.id] : [],
    ),
  );
  if (
    content.options.some(
      (option) => option.id !== undefined && !sourceOptionIds.has(option.id),
    ) ||
    content.statements.some(
      (statement) =>
        statement.id !== undefined && !sourceStatementIds.has(statement.id),
    )
  )
    throw new QuestionForeignReferenceError();
}

export async function hashQuestionContent(
  content: QuestionDraftContent,
  media: readonly MediaRelation[] = [],
): Promise<Uint8Array> {
  return hashCanonicalQuestion(
    content,
    media.map((item) => ({
      placementKey: item.placementKey ?? `${item.questionRevisionId}-${item.mediaAssetId}`,
      mediaAssetId: item.mediaAssetId,
      usage: item.usage,
      questionOptionId: item.questionOptionId ?? null,
      trueFalseStatementId: item.trueFalseStatementId ?? null,
      sortOrder: item.sortOrder ?? 0,
      altText: item.altText,
      isDecorative: item.isDecorative,
      displayWidthPercent: item.displayWidthPercent ?? 100,
      alignment: item.alignment ?? "CENTER",
    })),
  );
}
