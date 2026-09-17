import type { Id } from "@gezycbt/contracts";
import {
  assertMutationContext,
  type UseCaseContext,
} from "../../application/actor-context";
import type { AuthorizationPolicyService } from "../../application/authorization";
import {
  type QuestionDraft,
  QuestionImmutableError,
  QuestionNotFoundError,
} from "./domain";
import {
  type QuestionReadinessReport,
  validateQuestionReadiness,
} from "./readiness";
import type { QuestionPublishRepository } from "./repository";

export class QuestionPublishBlockedError extends Error {
  constructor(readonly report: QuestionReadinessReport) {
    super("Question revision is not ready to publish");
    this.name = "QuestionPublishBlockedError";
  }
}

export class QuestionPublishService {
  constructor(
    private readonly repository: QuestionPublishRepository,
    private readonly authorization: Pick<
      AuthorizationPolicyService,
      "assertTeacherScope"
    >,
  ) {}

  async publish(
    context: UseCaseContext,
    revisionId: Id,
    expectedUpdatedAt?: QuestionDraft["updatedAt"],
  ): Promise<QuestionDraft> {
    assertMutationContext(context);
    if (!expectedUpdatedAt) {
      throw new Error("Publishing requires expectedUpdatedAt");
    }
    const revision = await this.repository.findRevision(revisionId);
    if (!revision) throw new QuestionNotFoundError();
    await this.authorization.assertTeacherScope(
      context.actor,
      revision.questionBank,
    );
    if (revision.status !== "DRAFT") throw new QuestionImmutableError();
    const report = validateQuestionReadiness(revision.id, revision);
    if (!report.isReady) throw new QuestionPublishBlockedError(report);
    const published = await this.repository.publishRevision(
      revisionId,
      expectedUpdatedAt,
    );
    if (!published) throw new QuestionNotFoundError();
    return published;
  }
}
