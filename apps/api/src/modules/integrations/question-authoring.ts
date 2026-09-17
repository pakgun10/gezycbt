import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import type {
  ActorContext,
  UseCaseContext,
} from "../../application/actor-context";
import type { MediaAsset } from "../media/domain";
import type { AttachMediaInput, MediaRelation } from "../media/relation-domain";
import type { MediaRelationService } from "../media/relation-service";
import type { MediaUploadService } from "../media/service";
import type {
  CreateQuestionDraftInput,
  QuestionDraft,
  QuestionDraftContent,
} from "../questions/domain";
import type { QuestionPublishService } from "../questions/publish";
import type {
  QuestionReadinessReport,
  QuestionReadinessService,
} from "../questions/readiness";
import type { QuestionDraftRepository } from "../questions/repository";
import type { QuestionDraftService } from "../questions/service";
import type { IntegrationAuthentication, IntegrationGrant } from "./domain";
import type { IntegrationService } from "./service";

export interface AgentQuestionAuthoringOptions {
  readonly integration: IntegrationService;
  readonly repository: Pick<
    QuestionDraftRepository,
    "findQuestionBank" | "findRevision" | "findLatestRevisionByQuestionId"
  >;
  readonly drafts: QuestionDraftService;
  readonly publish: QuestionPublishService;
  readonly readiness: QuestionReadinessService;
  readonly mediaUpload?: MediaUploadService;
  readonly mediaRelations?: MediaRelationService;
}

export interface AgentQuestionView {
  readonly id: Id;
  readonly questionId: Id;
  readonly questionBank: {
    readonly id: Id;
    readonly subjectId: Id;
    readonly ownerTeacherId: Id;
    readonly name: string;
    readonly status: string;
  };
  readonly questionStatus: string;
  readonly revisionNo: number;
  readonly type: QuestionDraft["type"];
  readonly status: QuestionDraft["status"];
  readonly stimulusHtml: string;
  readonly promptHtml: string | null;
  readonly explanationHtml: string | null;
  readonly options: readonly AgentOptionView[];
  readonly statements: readonly AgentStatementView[];
  readonly contentHash: string;
  readonly publishedAt: UtcTimestamp | null;
  readonly createdAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp;
  readonly media: readonly MediaRelation[];
  /** Present only when the caller holds questions.read_key. */
  readonly answerKeyIncluded: boolean;
}

export interface AgentOptionView {
  readonly id?: Id;
  readonly position: number;
  readonly contentHtml: string;
  readonly isCorrect?: boolean;
}

export interface AgentStatementView {
  readonly id?: Id;
  readonly position: number;
  readonly statementHtml: string;
  readonly correctValue?: boolean;
}

export interface AgentMediaView {
  readonly id: Id;
  readonly originalName: string;
  readonly mimeType: MediaAsset["mimeType"];
  readonly byteSize: number;
  readonly width: number;
  readonly height: number;
  readonly status: MediaAsset["status"];
}

export class IntegrationQuestionAuthoringService {
  constructor(private readonly options: AgentQuestionAuthoringOptions) {}

  async getQuestion(
    authentication: IntegrationAuthentication,
    requestedId: Id,
    includeKey: boolean,
    requestId: string,
  ): Promise<AgentQuestionView> {
    const grant = await this.options.integration.assertCapability(
      authentication,
      includeKey ? "questions.read_key" : "questions.read",
      requestId,
    );
    const revision = await this.resolveQuestion(requestedId);
    if (!revision) throw new AgentQuestionNotFoundError();
    await this.assertScope(authentication, grant, revision);
    const context = this.context(authentication, requestId);
    const loaded = await this.options.drafts.getDraft(context, revision.id);
    const media = this.options.mediaRelations
      ? await this.options.mediaRelations.list(context, revision.id)
      : [];
    if (includeKey) {
      await this.options.integration.recordAgentAudit({
        action: "INTEGRATION_QUESTION_READ_KEY",
        clientId: authentication.client.id,
        actorUserId: authentication.client.ownerUserId,
        entityType: "question_revision",
        entityId: loaded.id,
        requestId,
        outcome: "SUCCESS",
        metadata: {
          questionId: loaded.questionId,
          revisionNo: loaded.revisionNo,
        },
      });
    }
    return presentQuestion(loaded, includeKey, media);
  }

  async createQuestion(
    authentication: IntegrationAuthentication,
    input: CreateQuestionDraftInput,
    requestId: string,
    idempotencyKey: string,
  ): Promise<AgentQuestionView> {
    const grant = await this.options.integration.assertCapability(
      authentication,
      "questions.create",
      requestId,
    );
    const bank = await this.options.repository.findQuestionBank(
      input.questionBankId,
    );
    if (!bank) throw new AgentQuestionNotFoundError();
    await this.assertScope(authentication, grant, {
      questionBank: bank,
    });
    const revision = await this.options.drafts.createDraft(
      this.context(authentication, requestId, idempotencyKey),
      input,
    );
    await this.audit(
      authentication,
      "INTEGRATION_QUESTION_CREATE",
      revision.id,
      requestId,
      { questionId: revision.questionId },
    );
    return presentQuestion(revision, false, []);
  }

  async updateQuestion(
    authentication: IntegrationAuthentication,
    revisionId: Id,
    input: QuestionDraftContent,
    expectedUpdatedAt: UtcTimestamp,
    requestId: string,
    idempotencyKey: string,
  ): Promise<AgentQuestionView> {
    const grant = await this.options.integration.assertCapability(
      authentication,
      "questions.update",
      requestId,
    );
    const revision = await this.requireScopedRevision(
      authentication,
      grant,
      revisionId,
    );
    const updated = await this.options.drafts.updateDraft(
      this.context(authentication, requestId, idempotencyKey),
      revision.id,
      input,
      expectedUpdatedAt,
    );
    const media = this.options.mediaRelations
      ? await this.options.mediaRelations.list(
          this.context(authentication, requestId),
          updated.id,
        )
      : [];
    await this.audit(
      authentication,
      "INTEGRATION_QUESTION_UPDATE",
      updated.id,
      requestId,
      { questionId: updated.questionId },
    );
    return presentQuestion(updated, false, media);
  }

  async createRevision(
    authentication: IntegrationAuthentication,
    questionId: Id,
    input: QuestionDraftContent,
    expectedUpdatedAt: UtcTimestamp,
    requestId: string,
    idempotencyKey: string,
  ): Promise<AgentQuestionView> {
    const latest = await this.resolveQuestion(questionId);
    if (!latest) throw new AgentQuestionNotFoundError();
    const content =
      latest.status === "PUBLISHED"
        ? {
            ...input,
            options: input.options.map(({ id: _id, ...option }) => option),
            statements: input.statements.map(
              ({ id: _id, ...statement }) => statement,
            ),
          }
        : input;
    return this.updateQuestion(
      authentication,
      latest.id,
      content,
      expectedUpdatedAt,
      requestId,
      idempotencyKey,
    );
  }

  async validateQuestion(
    authentication: IntegrationAuthentication,
    revisionId: Id,
    requestId: string,
  ): Promise<QuestionReadinessReport> {
    const grant = await this.options.integration.assertCapability(
      authentication,
      "questions.read",
      requestId,
    );
    const revision = await this.requireScopedRevision(
      authentication,
      grant,
      revisionId,
    );
    const report = await this.options.readiness.validateRevision(revision.id);
    if (!report) throw new AgentQuestionNotFoundError();
    return report;
  }

  async publishQuestion(
    authentication: IntegrationAuthentication,
    revisionId: Id,
    expectedUpdatedAt: UtcTimestamp,
    requestId: string,
    idempotencyKey: string,
  ): Promise<AgentQuestionView> {
    const grant = await this.options.integration.assertCapability(
      authentication,
      "questions.publish",
      requestId,
    );
    const revision = await this.requireScopedRevision(
      authentication,
      grant,
      revisionId,
    );
    const published = await this.options.publish.publish(
      this.context(authentication, requestId, idempotencyKey),
      revision.id,
      expectedUpdatedAt,
    );
    const media = this.options.mediaRelations
      ? await this.options.mediaRelations.list(
          this.context(authentication, requestId),
          published.id,
        )
      : [];
    await this.audit(
      authentication,
      "INTEGRATION_QUESTION_PUBLISH",
      published.id,
      requestId,
      { questionId: published.questionId, revisionNo: published.revisionNo },
    );
    return presentQuestion(published, false, media);
  }

  async uploadMedia(
    authentication: IntegrationAuthentication,
    input: {
      readonly bytes: Uint8Array;
      readonly originalName: string;
      readonly claimedMimeType?: string;
    },
    requestId: string,
    idempotencyKey: string,
  ): Promise<AgentMediaView> {
    await this.options.integration.assertCapability(
      authentication,
      "media.upload",
      requestId,
    );
    if (!this.options.mediaUpload)
      throw new Error("Media upload is not configured");
    const asset = await this.options.mediaUpload.upload({
      ...input,
      claimedMimeType: input.claimedMimeType,
      createdBy: authentication.client.ownerUserId,
    });
    await this.options.integration.recordAgentAudit({
      action: "INTEGRATION_MEDIA_UPLOAD",
      clientId: authentication.client.id,
      actorUserId: authentication.client.ownerUserId,
      entityType: "media_asset",
      entityId: asset.id,
      requestId,
      outcome: "SUCCESS",
      metadata: { originalName: asset.originalName, byteSize: asset.byteSize },
    });
    // Keep the argument in the public method to make the mutation boundary
    // explicit. Durable replay storage is introduced with the action workflow.
    void idempotencyKey;
    return presentMedia(asset);
  }

  async attachMedia(
    authentication: IntegrationAuthentication,
    input: AttachMediaInput,
    requestId: string,
    idempotencyKey: string,
  ): Promise<MediaRelation> {
    const grant = await this.options.integration.assertCapability(
      authentication,
      "media.upload",
      requestId,
    );
    if (!this.options.mediaRelations)
      throw new Error("Media relation service is not configured");
    const revision = await this.resolveRevisionId(input.questionRevisionId);
    if (!revision) throw new AgentQuestionNotFoundError();
    await this.assertScope(authentication, grant, revision);
    const relation = await this.options.mediaRelations.attach(
      this.context(authentication, requestId, idempotencyKey),
      input,
    );
    await this.audit(
      authentication,
      "INTEGRATION_MEDIA_ATTACH",
      input.questionRevisionId,
      requestId,
      { mediaAssetId: input.mediaAssetId },
    );
    return relation;
  }

  private async requireScopedRevision(
    authentication: IntegrationAuthentication,
    grant: IntegrationGrant,
    revisionId: Id,
  ): Promise<QuestionDraft> {
    const revision = await this.resolveRevisionId(revisionId);
    if (!revision) throw new AgentQuestionNotFoundError();
    await this.assertScope(authentication, grant, revision);
    return revision;
  }

  private async resolveQuestion(id: Id): Promise<QuestionDraft | null> {
    const byQuestion =
      await this.options.repository.findLatestRevisionByQuestionId?.(id);
    if (byQuestion) return byQuestion;
    return this.options.repository.findRevision(id);
  }

  private resolveRevisionId(id: Id): Promise<QuestionDraft | null> {
    return this.options.repository.findRevision(id);
  }

  private async assertScope(
    authentication: IntegrationAuthentication,
    grant: IntegrationGrant,
    revision:
      | QuestionDraft
      | { readonly questionBank: QuestionDraft["questionBank"] },
  ): Promise<void> {
    await this.options.integration.assertResourceScope(authentication, grant, {
      ownerUserId: revision.questionBank.ownerTeacherId,
      subjectId: revision.questionBank.subjectId,
      resourceId: revision.questionBank.id,
    });
  }

  private context(
    authentication: IntegrationAuthentication,
    requestId: string,
    idempotencyKey?: string,
  ): UseCaseContext {
    const actor: ActorContext = {
      actorType: "EXTERNAL_AGENT",
      userId: authentication.client.ownerUserId,
      role: authentication.client.ownerRole,
      active: true,
      integrationClientId: authentication.client.id,
      requestId,
    };
    return idempotencyKey ? { actor, idempotencyKey } : { actor };
  }

  private async audit(
    authentication: IntegrationAuthentication,
    action: string,
    entityId: Id,
    requestId: string,
    metadata: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    await this.options.integration.recordAgentAudit({
      action,
      clientId: authentication.client.id,
      actorUserId: authentication.client.ownerUserId,
      entityType: "question_revision",
      entityId,
      requestId,
      outcome: "SUCCESS",
      metadata,
    });
  }
}

export class AgentQuestionNotFoundError extends Error {
  constructor() {
    super("Question revision was not found");
    this.name = "AgentQuestionNotFoundError";
  }
}

function presentQuestion(
  question: QuestionDraft,
  includeKey: boolean,
  media: readonly MediaRelation[],
): AgentQuestionView {
  return {
    id: question.id,
    questionId: question.questionId,
    questionBank: question.questionBank,
    questionStatus: question.questionStatus,
    revisionNo: question.revisionNo,
    type: question.type,
    status: question.status,
    stimulusHtml: question.stimulusHtml,
    promptHtml: question.promptHtml,
    explanationHtml: question.explanationHtml,
    options: question.options.map((option) => ({
      ...(option.id ? { id: option.id } : {}),
      position: option.position,
      contentHtml: option.contentHtml,
      ...(includeKey ? { isCorrect: option.isCorrect } : {}),
    })),
    statements: question.statements.map((statement) => ({
      ...(statement.id ? { id: statement.id } : {}),
      position: statement.position,
      statementHtml: statement.statementHtml,
      ...(includeKey ? { correctValue: statement.correctValue } : {}),
    })),
    contentHash: bytesToHex(question.contentHash),
    publishedAt: question.publishedAt,
    createdAt: question.createdAt,
    updatedAt: question.updatedAt,
    media,
    answerKeyIncluded: includeKey,
  };
}

function presentMedia(asset: MediaAsset): AgentMediaView {
  return {
    id: asset.id,
    originalName: asset.originalName,
    mimeType: asset.mimeType,
    byteSize: asset.byteSize,
    width: asset.width,
    height: asset.height,
    status: asset.status,
  };
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
