import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import {
  assertMutationContext,
  type UseCaseContext,
} from "../../application/actor-context";
import type { AuthorizationPolicyService } from "../../application/authorization";
import {
  ExamImmutableError,
  type ExamRevision,
  ExamRevisionNotFoundError,
} from "./domain";
import { type ExamReadinessReport, validateExamReadiness } from "./readiness";
import type { ExamDraftRepository } from "./repository";

export class ExamPublishBlockedError extends Error {
  constructor(readonly report: ExamReadinessReport) {
    super("Exam revision is not ready to publish");
    this.name = "ExamPublishBlockedError";
  }
}

export class ExamPublishService {
  constructor(
    private readonly repository: ExamDraftRepository,
    private readonly authorization: Pick<
      AuthorizationPolicyService,
      "assertTeacherScope"
    >,
  ) {}

  async publish(
    context: UseCaseContext,
    revisionId: Id,
    expectedUpdatedAt?: UtcTimestamp,
  ): Promise<ExamRevision> {
    assertMutationContext(context);
    if (!expectedUpdatedAt)
      throw new Error("Publishing requires expectedUpdatedAt");
    const revision = await this.repository.findRevision(revisionId);
    if (!revision) throw new ExamRevisionNotFoundError();
    await this.authorization.assertTeacherScope(context.actor, revision.exam);
    if (revision.status !== "DRAFT") throw new ExamImmutableError();

    const references = await Promise.all(
      revision.questions.map((question) =>
        this.repository.findQuestionRevision(question.questionRevisionId),
      ),
    );
    const report = validateExamReadiness(revision, references);
    if (!report.isReady) throw new ExamPublishBlockedError(report);

    const published = await this.repository.publishRevision(
      revisionId,
      expectedUpdatedAt,
      report.totalPoints,
    );
    if (!published) throw new ExamRevisionNotFoundError();
    return published;
  }
}
