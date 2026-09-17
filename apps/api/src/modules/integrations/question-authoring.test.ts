import { describe, expect, test } from "bun:test";
import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import type { QuestionDraft } from "../questions/domain";
import {
  type IntegrationAuthentication,
  IntegrationCapabilityError,
  type IntegrationGrant,
} from "./domain";
import {
  type AgentQuestionAuthoringOptions,
  IntegrationQuestionAuthoringService,
} from "./question-authoring";

const NOW = "2026-09-17T00:00:00.000Z" as UtcTimestamp;
const bank = {
  id: "20" as Id,
  subjectId: "30" as Id,
  ownerTeacherId: "40" as Id,
  name: "Bank Matematika",
  status: "ACTIVE" as const,
};
const question: QuestionDraft = {
  id: "50" as Id,
  questionId: "51" as Id,
  questionBank: bank,
  questionStatus: "ACTIVE",
  revisionNo: 1,
  type: "SINGLE_CHOICE",
  status: "DRAFT",
  stimulusHtml: "Stimulus",
  promptHtml: "Berapa hasilnya?",
  explanationHtml: "Pembahasan",
  options: [
    { id: "60" as Id, position: 1, contentHtml: "A", isCorrect: true },
    { id: "61" as Id, position: 2, contentHtml: "B", isCorrect: false },
  ],
  statements: [],
  contentHash: new Uint8Array([1, 2, 3]),
  publishedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
};

function authentication(
  capabilities: readonly string[] = ["questions.read"],
): IntegrationAuthentication {
  return {
    client: {
      id: "10" as Id,
      name: "Agent",
      platformHint: "HIVEKEEP",
      ownerUserId: bank.ownerTeacherId,
      ownerDisplayName: "Guru",
      ownerRole: "TEACHER",
      status: "ACTIVE",
      description: null,
      policyVersion: 1,
      createdByUserId: bank.ownerTeacherId,
      lastUsedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    credential: {
      id: "11" as Id,
      integrationClientId: "10" as Id,
      tokenPrefix: "prefix",
      status: "ACTIVE",
      validFrom: NOW,
      expiresAt: null,
      lastUsedAt: null,
      revokedAt: null,
      revokeReason: null,
      createdAt: NOW,
    },
    grants: capabilities.map((capability, index) => grant(capability, index)),
  };
}

function grant(capability: string, index = 0): IntegrationGrant {
  return {
    id: String(100 + index) as Id,
    integrationClientId: "10" as Id,
    capability,
    scopeType: "SUBJECT",
    scopeIds: [bank.subjectId],
    constraints: {},
    grantVersion: index + 1,
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

function setup(capabilities: readonly string[] = ["questions.read"]): {
  service: IntegrationQuestionAuthoringService;
  auth: IntegrationAuthentication;
  audits: { action: string; metadata?: Readonly<Record<string, unknown>> }[];
  contexts: {
    actorType: string;
    integrationClientId: Id | undefined;
    idempotencyKey: string | undefined;
  }[];
} {
  const auth = authentication(capabilities);
  const audits: {
    action: string;
    metadata?: Readonly<Record<string, unknown>>;
  }[] = [];
  const contexts: {
    actorType: string;
    integrationClientId: Id | undefined;
    idempotencyKey: string | undefined;
  }[] = [];
  const integration = {
    async assertCapability(
      input: IntegrationAuthentication,
      capability: string,
    ): Promise<IntegrationGrant> {
      const found = input.grants.find(
        (candidate) => candidate.capability === capability,
      );
      if (!found) throw new IntegrationCapabilityError(capability);
      return found;
    },
    async assertResourceScope() {},
    async recordAgentAudit(event: {
      action: string;
      metadata?: Readonly<Record<string, unknown>>;
    }) {
      audits.push(event);
    },
  };
  const drafts = {
    async getDraft() {
      return question;
    },
    async createDraft(context: {
      actor: { actorType: string; integrationClientId?: Id };
      idempotencyKey?: string;
    }) {
      contexts.push({
        actorType: context.actor.actorType,
        integrationClientId: context.actor.integrationClientId,
        idempotencyKey: context.idempotencyKey,
      });
      return question;
    },
    async updateDraft(context: {
      actor: { actorType: string; integrationClientId?: Id };
      idempotencyKey?: string;
    }) {
      contexts.push({
        actorType: context.actor.actorType,
        integrationClientId: context.actor.integrationClientId,
        idempotencyKey: context.idempotencyKey,
      });
      return question;
    },
  };
  const options: AgentQuestionAuthoringOptions = {
    integration: integration as never,
    repository: {
      async findRevision() {
        return question;
      },
      async findQuestionBank() {
        return bank;
      },
      async findLatestRevisionByQuestionId() {
        return question;
      },
    },
    drafts: drafts as never,
    publish: {} as never,
    readiness: {} as never,
    mediaRelations: {
      async list() {
        return [];
      },
    } as never,
  };
  return {
    service: new IntegrationQuestionAuthoringService(options),
    auth,
    audits,
    contexts,
  };
}

describe("agent question authoring", () => {
  test("safe reads omit answer keys while read_key is explicit and audited", async () => {
    const safe = setup();
    const view = await safe.service.getQuestion(
      safe.auth,
      question.id,
      false,
      "req-1",
    );
    expect(view.answerKeyIncluded).toBe(false);
    const safeOption = view.options.at(0);
    if (!safeOption) throw new Error("Expected a question option");
    expect(safeOption).not.toHaveProperty("isCorrect");
    expect(safe.audits).toHaveLength(0);

    const keyed = setup(["questions.read_key"]);
    const keyedView = await keyed.service.getQuestion(
      keyed.auth,
      question.id,
      true,
      "req-2",
    );
    const keyedOption = keyedView.options.at(0);
    if (!keyedOption) throw new Error("Expected a keyed question option");
    expect(keyedOption.isCorrect).toBe(true);
    expect(keyed.audits.map((item) => item.action)).toEqual([
      "INTEGRATION_QUESTION_READ_KEY",
    ]);
  });

  test("answer key access fails without the separate capability", async () => {
    const setupValue = setup();
    await expect(
      setupValue.service.getQuestion(
        setupValue.auth,
        question.id,
        true,
        "req-3",
      ),
    ).rejects.toBeInstanceOf(IntegrationCapabilityError);
  });

  test("creation delegates an external-agent context with idempotency", async () => {
    const setupValue = setup(["questions.create"]);
    await setupValue.service.createQuestion(
      setupValue.auth,
      {
        questionBankId: bank.id,
        type: question.type,
        stimulusHtml: question.stimulusHtml,
        promptHtml: question.promptHtml,
        explanationHtml: question.explanationHtml,
        options: question.options.map(({ id: _id, ...option }) => option),
        statements: [],
      },
      "req-4",
      "idempotency-key-1234",
    );
    expect(setupValue.contexts).toEqual([
      {
        actorType: "EXTERNAL_AGENT",
        integrationClientId: "10" as Id,
        idempotencyKey: "idempotency-key-1234",
      },
    ]);
  });
});
