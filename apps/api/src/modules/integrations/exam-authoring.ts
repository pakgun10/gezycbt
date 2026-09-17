import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import type {
  ActorContext,
  UseCaseContext,
} from "../../application/actor-context";
import type {
  AddExamQuestionInput,
  CreateExamInput,
  ExamDraftMetadata,
  ExamRevision,
  UpdateExamRevisionInput,
} from "../exams/domain";
import type { ExamPublishService } from "../exams/publish";
import type {
  ExamReadinessReport,
  ExamReadinessService,
} from "../exams/readiness";
import type { ExamDraftService } from "../exams/service";
import {
  type IntegrationAuthentication,
  type IntegrationGrant,
  IntegrationValidationError,
} from "./domain";
import type { IntegrationService } from "./service";

export interface AgentExamAuthoringOptions {
  readonly integration: IntegrationService;
  readonly drafts: ExamDraftService;
  readonly publish: ExamPublishService;
  readonly readiness: ExamReadinessService;
}

/**
 * Stable, answer-key-free representation used by the external agent API.
 * Question content remains available through the question authoring surface;
 * an exam view only needs the selected revision IDs and scoring metadata.
 */
export interface AgentExamView {
  readonly id: Id;
  readonly examId: Id;
  readonly subjectId: Id;
  readonly ownerTeacherId: Id;
  readonly examStatus: string;
  readonly revisionNo: number;
  readonly status: string;
  readonly title: string;
  readonly instructionsHtml: string;
  readonly durationSeconds: number;
  readonly shuffleQuestions: boolean;
  readonly shuffleOptions: boolean;
  readonly totalPoints: string;
  readonly publishedAt: UtcTimestamp | null;
  readonly updatedAt: UtcTimestamp;
  readonly questions: readonly AgentExamQuestionView[];
}

export interface AgentExamQuestionView {
  readonly questionRevisionId: Id;
  readonly position: number;
  readonly points: string;
}

export interface AgentCreateExamInput extends ExamDraftMetadata {
  readonly subjectId: Id;
  /** Required for an ADMIN-owned client; a TEACHER client is bound to itself. */
  readonly ownerTeacherId?: Id;
}

export class AgentExamNotFoundError extends Error {
  constructor() {
    super("Exam or exam revision was not found");
    this.name = "AgentExamNotFoundError";
  }
}

export class IntegrationExamAuthoringService {
  constructor(private readonly options: AgentExamAuthoringOptions) {}

  async getExam(
    authentication: IntegrationAuthentication,
    examId: Id,
    requestId: string,
  ): Promise<AgentExamView> {
    const grant = await this.options.integration.assertCapability(
      authentication,
      "exams.read",
      requestId,
    );
    const revision = await this.options.drafts.getExam(
      this.context(authentication, requestId),
      examId,
    );
    if (!revision) throw new AgentExamNotFoundError();
    await this.assertScope(authentication, grant, revision);
    return presentExam(revision);
  }

  async createExam(
    authentication: IntegrationAuthentication,
    input: AgentCreateExamInput,
    requestId: string,
    idempotencyKey: string,
  ): Promise<AgentExamView> {
    const grant = await this.options.integration.assertCapability(
      authentication,
      "exams.create",
      requestId,
    );
    const ownerTeacherId =
      authentication.client.ownerRole === "TEACHER"
        ? authentication.client.ownerUserId
        : input.ownerTeacherId;
    if (!ownerTeacherId)
      throw new IntegrationValidationError(
        "ownerTeacherId wajib diisi untuk client ADMIN",
      );
    await this.options.integration.assertResourceScope(authentication, grant, {
      ownerUserId: ownerTeacherId,
      subjectId: input.subjectId,
    });
    const revision = await this.options.drafts.createExam(
      this.context(authentication, requestId, idempotencyKey),
      { ...input, ownerTeacherId } as CreateExamInput,
    );
    await this.audit(
      authentication,
      "INTEGRATION_EXAM_CREATE",
      revision,
      requestId,
    );
    return presentExam(revision);
  }

  async createRevision(
    authentication: IntegrationAuthentication,
    examId: Id,
    input: ExamDraftMetadata,
    requestId: string,
    idempotencyKey: string,
  ): Promise<AgentExamView> {
    const grant = await this.options.integration.assertCapability(
      authentication,
      "exams.update",
      requestId,
    );
    const current = await this.options.drafts.getExam(
      this.context(authentication, requestId),
      examId,
    );
    if (!current) throw new AgentExamNotFoundError();
    await this.assertScope(authentication, grant, current);
    const revision = await this.options.drafts.createDraftRevision(
      this.context(authentication, requestId, idempotencyKey),
      examId,
      input,
    );
    return this.auditAndPresent(
      authentication,
      "INTEGRATION_EXAM_REVISION_CREATE",
      revision,
      requestId,
    );
  }

  async updateRevision(
    authentication: IntegrationAuthentication,
    revisionId: Id,
    input: UpdateExamRevisionInput,
    expectedUpdatedAt: UtcTimestamp,
    requestId: string,
    idempotencyKey: string,
  ): Promise<AgentExamView> {
    const grant = await this.options.integration.assertCapability(
      authentication,
      "exams.update",
      requestId,
    );
    const current = await this.requireRevision(
      authentication,
      grant,
      revisionId,
      requestId,
    );
    const revision = await this.options.drafts.updateRevision(
      this.context(authentication, requestId, idempotencyKey),
      current.id,
      input,
      expectedUpdatedAt,
    );
    return this.auditAndPresent(
      authentication,
      "INTEGRATION_EXAM_REVISION_UPDATE",
      revision,
      requestId,
    );
  }

  async addQuestion(
    authentication: IntegrationAuthentication,
    revisionId: Id,
    input: AddExamQuestionInput,
    expectedUpdatedAt: UtcTimestamp,
    requestId: string,
    idempotencyKey: string,
  ): Promise<AgentExamView> {
    return this.mutateQuestionList(
      authentication,
      "exams.attach_questions",
      revisionId,
      expectedUpdatedAt,
      requestId,
      idempotencyKey,
      (context) =>
        this.options.drafts.addQuestion(
          context,
          revisionId,
          input,
          expectedUpdatedAt,
        ),
      "INTEGRATION_EXAM_QUESTION_ATTACH",
    );
  }

  async removeQuestion(
    authentication: IntegrationAuthentication,
    revisionId: Id,
    questionRevisionId: Id,
    expectedUpdatedAt: UtcTimestamp,
    requestId: string,
    idempotencyKey: string,
  ): Promise<AgentExamView> {
    return this.mutateQuestionList(
      authentication,
      "exams.attach_questions",
      revisionId,
      expectedUpdatedAt,
      requestId,
      idempotencyKey,
      (context) =>
        this.options.drafts.removeQuestion(
          context,
          revisionId,
          questionRevisionId,
          expectedUpdatedAt,
        ),
      "INTEGRATION_EXAM_QUESTION_REMOVE",
    );
  }

  async reorderQuestions(
    authentication: IntegrationAuthentication,
    revisionId: Id,
    orderedQuestionRevisionIds: readonly Id[],
    expectedUpdatedAt: UtcTimestamp,
    requestId: string,
    idempotencyKey: string,
  ): Promise<AgentExamView> {
    return this.mutateQuestionList(
      authentication,
      "exams.attach_questions",
      revisionId,
      expectedUpdatedAt,
      requestId,
      idempotencyKey,
      (context) =>
        this.options.drafts.reorderQuestions(
          context,
          revisionId,
          orderedQuestionRevisionIds,
          expectedUpdatedAt,
        ),
      "INTEGRATION_EXAM_QUESTION_REORDER",
    );
  }

  async validateRevision(
    authentication: IntegrationAuthentication,
    revisionId: Id,
    requestId: string,
  ): Promise<ExamReadinessReport> {
    const grant = await this.options.integration.assertCapability(
      authentication,
      "exams.read",
      requestId,
    );
    const revision = await this.requireRevision(
      authentication,
      grant,
      revisionId,
      requestId,
    );
    const report = await this.options.readiness.validateRevision(revision.id);
    if (!report) throw new AgentExamNotFoundError();
    return report;
  }

  async publishRevision(
    authentication: IntegrationAuthentication,
    revisionId: Id,
    expectedUpdatedAt: UtcTimestamp,
    requestId: string,
    idempotencyKey: string,
  ): Promise<AgentExamView> {
    const grant = await this.options.integration.assertCapability(
      authentication,
      "exams.publish",
      requestId,
    );
    const current = await this.requireRevision(
      authentication,
      grant,
      revisionId,
      requestId,
    );
    const revision = await this.options.publish.publish(
      this.context(authentication, requestId, idempotencyKey),
      current.id,
      expectedUpdatedAt,
    );
    return this.auditAndPresent(
      authentication,
      "INTEGRATION_EXAM_PUBLISH",
      revision,
      requestId,
    );
  }

  private async mutateQuestionList(
    authentication: IntegrationAuthentication,
    capability: string,
    revisionId: Id,
    _expectedUpdatedAt: UtcTimestamp,
    requestId: string,
    idempotencyKey: string,
    operation: (context: UseCaseContext) => Promise<ExamRevision>,
    action: string,
  ): Promise<AgentExamView> {
    const grant = await this.options.integration.assertCapability(
      authentication,
      capability,
      requestId,
    );
    const current = await this.requireRevision(
      authentication,
      grant,
      revisionId,
      requestId,
    );
    const revision = await operation(
      this.context(authentication, requestId, idempotencyKey),
    );
    return this.auditAndPresent(authentication, action, revision, requestId, {
      examId: current.examId,
    });
  }

  private async requireRevision(
    authentication: IntegrationAuthentication,
    grant: IntegrationGrant,
    revisionId: Id,
    requestId: string,
  ): Promise<ExamRevision> {
    const revision = await this.options.drafts.getRevision(
      this.context(authentication, requestId),
      revisionId,
    );
    if (!revision) throw new AgentExamNotFoundError();
    await this.assertScope(authentication, grant, revision);
    return revision;
  }

  private async assertScope(
    authentication: IntegrationAuthentication,
    grant: IntegrationGrant,
    revision: ExamRevision,
  ): Promise<void> {
    await this.options.integration.assertResourceScope(authentication, grant, {
      ownerUserId: revision.exam.ownerTeacherId,
      subjectId: revision.exam.subjectId,
      resourceId: revision.exam.id,
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

  private async auditAndPresent(
    authentication: IntegrationAuthentication,
    action: string,
    revision: ExamRevision | null,
    requestId: string,
    metadata: Readonly<Record<string, unknown>> = {},
  ): Promise<AgentExamView> {
    if (!revision) throw new AgentExamNotFoundError();
    await this.audit(authentication, action, revision, requestId, metadata);
    return presentExam(revision);
  }

  private async audit(
    authentication: IntegrationAuthentication,
    action: string,
    revision: ExamRevision,
    requestId: string,
    metadata: Readonly<Record<string, unknown>> = {},
  ): Promise<void> {
    await this.options.integration.recordAgentAudit({
      action,
      clientId: authentication.client.id,
      actorUserId: authentication.client.ownerUserId,
      entityType: "exam_revision",
      entityId: revision.id,
      requestId,
      outcome: "SUCCESS",
      metadata: {
        examId: revision.examId,
        revisionNo: revision.revisionNo,
        ...metadata,
      },
    });
  }
}

function presentExam(revision: ExamRevision): AgentExamView {
  return {
    id: revision.id,
    examId: revision.examId,
    subjectId: revision.exam.subjectId,
    ownerTeacherId: revision.exam.ownerTeacherId,
    examStatus: revision.exam.status,
    revisionNo: revision.revisionNo,
    status: revision.status,
    title: revision.title,
    instructionsHtml: revision.instructionsHtml,
    durationSeconds: revision.durationSeconds,
    shuffleQuestions: revision.shuffleQuestions,
    shuffleOptions: revision.shuffleOptions,
    totalPoints: revision.totalPoints,
    publishedAt: revision.publishedAt,
    updatedAt: revision.updatedAt,
    questions: revision.questions.map((question) => ({
      questionRevisionId: question.questionRevisionId,
      position: question.position,
      points: question.points,
    })),
  };
}
