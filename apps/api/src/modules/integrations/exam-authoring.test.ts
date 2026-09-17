import { describe, expect, test } from "bun:test";
import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import type { ExamRevision } from "../exams/domain";
import {
  type IntegrationAuthentication,
  IntegrationCapabilityError,
  type IntegrationGrant,
} from "./domain";
import {
  type AgentExamAuthoringOptions,
  IntegrationExamAuthoringService,
} from "./exam-authoring";

const NOW = "2026-09-17T00:00:00.000Z" as UtcTimestamp;
const exam: ExamRevision = {
  id: "101" as Id,
  examId: "100" as Id,
  exam: {
    id: "100" as Id,
    subjectId: "30" as Id,
    ownerTeacherId: "40" as Id,
    status: "DRAFT",
    currentPublishedRevisionId: null,
    createdAt: NOW,
    updatedAt: NOW,
  },
  revisionNo: 1,
  status: "DRAFT",
  title: "Ujian Matematika",
  instructionsHtml: "Kerjakan dengan teliti.",
  durationSeconds: 3600,
  shuffleQuestions: false,
  shuffleOptions: true,
  totalPoints: "10.00",
  publishedAt: null,
  questions: [
    {
      id: "201" as Id,
      examRevisionId: "101" as Id,
      questionRevisionId: "501" as Id,
      position: 1,
      points: "10.00",
      createdAt: NOW,
    },
  ],
  createdAt: NOW,
  updatedAt: NOW,
};

function grant(capability: string): IntegrationGrant {
  return {
    id: "900" as Id,
    integrationClientId: "901" as Id,
    capability,
    scopeType: "SUBJECT",
    scopeIds: ["30" as Id],
    constraints: {},
    grantVersion: 1,
    status: "ACTIVE",
    validFrom: NOW,
    expiresAt: null,
    issuedByUserId: "1" as Id,
    revokedAt: null,
    revokeReason: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function authentication(
  capabilities: readonly string[] = ["exams.read"],
): IntegrationAuthentication {
  return {
    client: {
      id: "901" as Id,
      name: "Exam agent",
      platformHint: "HIVEKEEP",
      ownerUserId: "40" as Id,
      ownerDisplayName: "Guru",
      ownerRole: "TEACHER",
      status: "ACTIVE",
      description: null,
      policyVersion: 1,
      createdByUserId: "40" as Id,
      lastUsedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    credential: {
      id: "902" as Id,
      integrationClientId: "901" as Id,
      tokenPrefix: "prefix",
      status: "ACTIVE",
      validFrom: NOW,
      expiresAt: null,
      lastUsedAt: null,
      revokedAt: null,
      revokeReason: null,
      createdAt: NOW,
    },
    grants: capabilities.map(grant),
  };
}

function setup(capabilities: readonly string[] = ["exams.read"]): {
  service: IntegrationExamAuthoringService;
  auth: IntegrationAuthentication;
  audits: string[];
  contexts: { actorType: string; idempotencyKey: string | undefined }[];
  scopes: Record<string, unknown>[];
} {
  const auth = authentication(capabilities);
  const audits: string[] = [];
  const contexts: { actorType: string; idempotencyKey: string | undefined }[] =
    [];
  const scopes: Record<string, unknown>[] = [];
  const integration = {
    async assertCapability(
      input: IntegrationAuthentication,
      capability: string,
    ): Promise<IntegrationGrant> {
      const found = input.grants.find((item) => item.capability === capability);
      if (!found) throw new IntegrationCapabilityError(capability);
      return found;
    },
    async assertResourceScope(
      _input: IntegrationAuthentication,
      _grant: IntegrationGrant,
      resource: Record<string, unknown>,
    ) {
      scopes.push(resource);
    },
    async recordAgentAudit(event: { action: string }) {
      audits.push(event.action);
    },
  };
  const drafts = {
    async getExam() {
      return exam;
    },
    async getRevision() {
      return exam;
    },
    async createExam(context: {
      actor: { actorType: string };
      idempotencyKey?: string;
    }) {
      contexts.push({
        actorType: context.actor.actorType,
        idempotencyKey: context.idempotencyKey,
      });
      return exam;
    },
    async createDraftRevision() {
      return exam;
    },
    async updateRevision() {
      return exam;
    },
    async addQuestion() {
      return exam;
    },
    async removeQuestion() {
      return exam;
    },
    async reorderQuestions() {
      return exam;
    },
  };
  const options: AgentExamAuthoringOptions = {
    integration: integration as never,
    drafts: drafts as never,
    publish: {
      async publish(context: {
        actor: { actorType: string };
        idempotencyKey?: string;
      }) {
        contexts.push({
          actorType: context.actor.actorType,
          idempotencyKey: context.idempotencyKey,
        });
        return exam;
      },
    } as never,
    readiness: {
      async validateRevision() {
        return {
          revisionId: exam.id,
          isReady: true,
          errorCount: 0,
          warningCount: 0,
          questionCount: 1,
          totalPoints: "10.00",
          issues: [],
        };
      },
    } as never,
  };
  return {
    service: new IntegrationExamAuthoringService(options),
    auth,
    audits,
    contexts,
    scopes,
  };
}

describe("agent exam authoring", () => {
  test("returns stable revision and question IDs without answer content", async () => {
    const value = setup();
    const result = await value.service.getExam(
      value.auth,
      exam.examId,
      "req-1",
    );
    expect(result).toMatchObject({
      id: "101",
      examId: "100",
      subjectId: "30",
      questions: [{ questionRevisionId: "501", position: 1, points: "10.00" }],
    });
    expect(result).not.toHaveProperty("answerKey");
    expect(value.scopes).toEqual([
      { ownerUserId: "40", subjectId: "30", resourceId: "100" },
    ]);
  });

  test("delegates create and publish through external-agent context", async () => {
    const value = setup(["exams.create", "exams.publish"]);
    await value.service.createExam(
      value.auth,
      {
        subjectId: "30" as Id,
        title: exam.title,
        instructionsHtml: exam.instructionsHtml,
        durationSeconds: exam.durationSeconds,
        shuffleQuestions: exam.shuffleQuestions,
        shuffleOptions: exam.shuffleOptions,
      },
      "req-2",
      "exam-idempotency-key",
    );
    await value.service.publishRevision(
      value.auth,
      exam.id,
      NOW,
      "req-3",
      "publish-idempotency-key",
    );
    expect(value.contexts).toEqual([
      { actorType: "EXTERNAL_AGENT", idempotencyKey: "exam-idempotency-key" },
      {
        actorType: "EXTERNAL_AGENT",
        idempotencyKey: "publish-idempotency-key",
      },
    ]);
    expect(value.audits).toEqual([
      "INTEGRATION_EXAM_CREATE",
      "INTEGRATION_EXAM_PUBLISH",
    ]);
  });

  test("requires explicit capability per operation", async () => {
    const value = setup(["exams.read"]);
    await expect(
      value.service.publishRevision(
        value.auth,
        exam.id,
        NOW,
        "req-4",
        "publish-idempotency-key",
      ),
    ).rejects.toBeInstanceOf(IntegrationCapabilityError);
  });
});
