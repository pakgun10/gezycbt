import { describe, expect, test } from "bun:test";
import type { Id } from "@gezycbt/contracts";
import type { UseCaseContext } from "../../application/actor-context";
import type { AuthorizationPolicyService } from "../../application/authorization";
import type { QuestionBankSummary } from "./domain";
import { QuestionImportService, QuestionImportValidationError } from "./import";
import type {
  QuestionImportBatchInput,
  QuestionImportRepository,
} from "./repository";

const ACTOR: UseCaseContext = {
  actor: {
    actorType: "HUMAN",
    role: "TEACHER",
    userId: "10" as Id,
    requestId: "question-import-test",
    active: true,
  },
  idempotencyKey: "question-import-idempotency-001",
};

const BANK: QuestionBankSummary = {
  id: "20" as Id,
  subjectId: "30" as Id,
  ownerTeacherId: "10" as Id,
  name: "Bank Matematika",
  status: "ACTIVE",
};

const HEADERS = [
  "type",
  "stimulus",
  "prompt",
  "explanation",
  ...Array.from({ length: 10 }, (_, index) => `option_${index + 1}`),
  ...Array.from({ length: 10 }, (_, index) => `option_${index + 1}_correct`),
  ...Array.from({ length: 3 }, (_, index) => `statement_${index + 1}`),
  ...Array.from({ length: 3 }, (_, index) => `statement_${index + 1}_correct`),
];

function csv(rows: readonly Record<string, string>[]): string {
  return [
    HEADERS.join(","),
    ...rows.map((row) => HEADERS.map((header) => row[header] ?? "").join(",")),
  ].join("\n");
}

function repository() {
  const batches: QuestionImportBatchInput[] = [];
  const value: QuestionImportRepository = {
    async findQuestionBank() {
      return BANK;
    },
    async createDraftBatch(input) {
      batches.push(input);
      return input.drafts.length;
    },
  };
  return { value, batches };
}

const authorization: Pick<AuthorizationPolicyService, "assertTeacherScope"> = {
  async assertTeacherScope() {
    return undefined;
  },
};

describe("QuestionImportService", () => {
  test("previews and atomically commits all three supported question types", async () => {
    const store = repository();
    const service = new QuestionImportService(store.value, authorization);
    const source = csv([
      {
        type: "SINGLE_CHOICE",
        stimulus: "Stimulus pilihan tunggal",
        prompt: "Pilih jawaban tepat",
        option_1: "A",
        option_1_correct: "BENAR",
        option_2: "B",
        option_2_correct: "SALAH",
      },
      {
        type: "MULTIPLE_RESPONSE",
        stimulus: "Stimulus pilihan banyak",
        prompt: "Pilih semua jawaban tepat",
        option_1: "A",
        option_1_correct: "TRUE",
        option_2: "B",
        option_2_correct: "FALSE",
        option_3: "C",
        option_3_correct: "1",
      },
      {
        type: "TRUE_FALSE",
        stimulus: "Stimulus benar salah",
        statement_1: "Pernyataan pertama",
        statement_1_correct: "BENAR",
        statement_2: "Pernyataan kedua",
        statement_2_correct: "SALAH",
        statement_3: "Pernyataan ketiga",
        statement_3_correct: "1",
      },
    ]);

    const preview = await service.preview(ACTOR, {
      questionBankId: BANK.id,
      csv: source,
    });
    expect(preview).toMatchObject({
      totalRows: 3,
      validCount: 3,
      errorCount: 0,
    });

    await expect(
      service.commit(ACTOR, {
        questionBankId: BANK.id,
        csv: source,
        sourceHash: preview.sourceHash,
      }),
    ).resolves.toEqual({ createdCount: 3 });
    expect(store.batches).toHaveLength(1);
    expect(store.batches[0]?.drafts.map((item) => item.content.type)).toEqual([
      "SINGLE_CHOICE",
      "MULTIPLE_RESPONSE",
      "TRUE_FALSE",
    ]);
  });

  test("blocks an invalid preview and refuses a changed source file", async () => {
    const service = new QuestionImportService(
      repository().value,
      authorization,
    );
    const invalid = csv([
      {
        type: "SINGLE_CHOICE",
        stimulus: "Stimulus",
        prompt: "Pertanyaan",
        option_1: "Satu opsi saja",
        option_1_correct: "BENAR",
      },
    ]);
    const preview = await service.preview(ACTOR, {
      questionBankId: BANK.id,
      csv: invalid,
    });
    expect(preview.errorCount).toBeGreaterThan(0);
    await expect(
      service.commit(ACTOR, {
        questionBankId: BANK.id,
        csv: invalid,
        sourceHash: preview.sourceHash,
      }),
    ).rejects.toBeInstanceOf(QuestionImportValidationError);
    await expect(
      service.commit(ACTOR, {
        questionBankId: BANK.id,
        csv: invalid,
        sourceHash: "0".repeat(64),
      }),
    ).rejects.toBeInstanceOf(QuestionImportValidationError);
  });
});
